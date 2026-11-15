/**
 * Writes markup into a PDF as an incremental update (spec sections 2–5): per page one Stamp annotation
 * with a PNG appearance, the fabric data in a hidden `/SMV_Data` stream and `/OC` pointing at our
 * Optional Content Group; the catalog gets `/SMV_Markup` metadata. The input bytes are never changed.
 */
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFPage,
} from "pdf-lib";
import { markupPayloadSchema, type MarkupPayload } from "../models/markup";
import { ANNOT_NM, MARKUP_FORMAT_VERSION, OCG_NAME, SMV_CATALOG_KEY, SMV_DATA_KEY } from "../models/markupConstants";
import { reserveObjectNumbers, writeIncrementalUpdate } from "./incrementalWriter";
import { annotEntries, classifyAnnot, readMarkup, visiblePageRect, type MarkupMeta } from "./readMarkup";

export interface PageChange {
  /** 1-based page number. */
  page: number;
  /** `null` removes our stamp from the page. */
  payload: MarkupPayload | null;
  /** Transparent PNG of the markup in display orientation; required when `payload` is set. */
  png: Uint8Array | null;
}

type Matrix = [number, number, number, number, number, number];

/**
 * `cm` matrix that draws the (display-oriented) image over the unrotated rect of size `w`×`h` so that it
 * appears upright on a page with `/Rotate rotation`. Like pdf.js, angles are taken modulo 360 and
 * angles that are no multiple of 90 count as 0.
 */
export function rotationMatrix(rotation: number, w: number, h: number): Matrix {
  switch ((((rotation % 360) + 360) % 360) as number) {
    case 90:
      return [0, h, -w, 0, w, 0];
    case 180:
      return [-w, 0, 0, -h, w, h];
    case 270:
      return [0, -h, w, 0, 0, h];
    default:
      return [w, 0, 0, h, 0, 0];
  }
}

/** Number for a content stream: no exponent notation, no `-0`. */
function num(n: number): string {
  const rounded = Math.round(n * 1e6) / 1e6;
  return String(rounded === 0 ? 0 : rounded);
}

/** Collects existing indirect objects that were modified and must be part of the update. */
class ChangedRefs {
  private readonly refs = new Map<string, PDFRef>();
  add(ref: PDFRef): void {
    this.refs.set(ref.toString(), ref);
  }
  values(): PDFRef[] {
    return [...this.refs.values()];
  }
}

/**
 * `dict[key]` if it is a `type` (direct, or indirect – then its ref is recorded as changed, because the
 * caller is going to modify it in place), otherwise `undefined`.
 */
function editable(doc: PDFDocument, dict: PDFDict, key: string, type: typeof PDFDict, changed: ChangedRefs): PDFDict | undefined;
function editable(doc: PDFDocument, dict: PDFDict, key: string, type: typeof PDFArray, changed: ChangedRefs): PDFArray | undefined;
function editable(
  doc: PDFDocument,
  dict: PDFDict,
  key: string,
  type: typeof PDFDict | typeof PDFArray,
  changed: ChangedRefs,
): PDFDict | PDFArray | undefined {
  const raw = dict.get(PDFName.of(key));
  if (raw instanceof type) return raw;
  if (raw instanceof PDFRef) {
    const target = doc.context.lookup(raw);
    if (target instanceof type) {
      changed.add(raw);
      return target;
    }
  }
  return undefined;
}

/**
 * Returns our OCG, creating it (`<< /Type /OCG /Name <UTF-16BE> >>`) if needed: it is added to `/OCGs`,
 * to `/D /Order` if that exists, and to `/D /ON` if `/D /BaseState` is `/OFF` (it must be on by default).
 */
function ensureOcg(doc: PDFDocument, existing: PDFRef | null, changed: ChangedRefs): PDFRef {
  if (existing) return existing;
  const { context, catalog } = doc;
  const ocg = context.register(context.obj({ Type: "OCG", Name: PDFHexString.fromText(OCG_NAME) }));

  const props = editable(doc, catalog, "OCProperties", PDFDict, changed);
  if (!props) {
    catalog.set(PDFName.of("OCProperties"), context.obj({ OCGs: [ocg], D: { Order: [ocg] } }));
    return ocg;
  }
  const ocgs = editable(doc, props, "OCGs", PDFArray, changed);
  if (ocgs) ocgs.push(ocg);
  else props.set(PDFName.of("OCGs"), context.obj([ocg]));

  let config = editable(doc, props, "D", PDFDict, changed);
  if (!config) {
    config = context.obj({});
    props.set(PDFName.of("D"), config);
  }
  editable(doc, config, "Order", PDFArray, changed)?.push(ocg);
  if (config.lookup(PDFName.of("BaseState")) === PDFName.of("OFF")) {
    const on = editable(doc, config, "ON", PDFArray, changed);
    if (on) on.push(ocg);
    else config.set(PDFName.of("ON"), context.obj([ocg]));
  }
  return ocg;
}

/** Creates the stamp annotation (with appearance and data stream) for `page` and returns its ref. */
async function createStamp(
  doc: PDFDocument,
  page: PDFPage,
  payload: MarkupPayload,
  png: Uint8Array,
  ocgRef: PDFRef,
): Promise<PDFRef> {
  const { context } = doc;
  const rect = visiblePageRect(context, page.node);
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];

  const image = await doc.embedPng(png);
  await image.embed(); // registers the image XObject (alpha becomes its /SMask)
  const matrix = rotationMatrix(page.getRotation().angle, w, h).map(num).join(" ");
  const form = context.register(
    context.flateStream(`q ${matrix} cm /Im0 Do Q`, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, w, h],
      Resources: { XObject: { Im0: image.ref } },
    }),
  );
  // UTF-8 bytes: pdf-lib would truncate a JS string to Latin-1.
  const data = context.register(context.flateStream(new TextEncoder().encode(JSON.stringify(payload))));
  return context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Stamp",
      Rect: rect,
      F: 4,
      NM: PDFString.of(ANNOT_NM),
      AP: { N: form },
      OC: ocgRef,
      P: page.ref,
      [SMV_DATA_KEY]: data,
    }),
  );
}

/** One change per page (the last one wins), validated. */
function normalizeChanges(changes: PageChange[]): Map<number, PageChange> {
  const byPage = new Map<number, PageChange>();
  for (const change of changes) {
    if (!Number.isInteger(change.page) || change.page < 1) throw new Error(`invalid page number ${change.page}`);
    if (change.payload !== null) {
      markupPayloadSchema.parse(change.payload); // never write data our reader would treat as an orphan
      if (!change.png) throw new Error(`page ${change.page}: markup without PNG appearance`);
    }
    byPage.set(change.page, change);
  }
  return byPage;
}

/**
 * Applies `changes` to `doc` (loaded from `base`, with object numbers reserved) and appends the update
 * to `base`.
 */
async function appendMarkupUpdate(
  base: Uint8Array,
  doc: PDFDocument,
  ocgRef: PDFRef | null,
  changes: Map<number, PageChange>,
  meta: MarkupMeta,
): Promise<Uint8Array> {
  const { context } = doc;
  const firstNew = context.largestObjectNumber + 1;
  const changed = new ChangedRefs();
  changed.add(context.trailerInfo.Root as PDFRef);
  const ocg = ensureOcg(doc, ocgRef, changed);

  const pages = doc.getPages();
  for (const [number, change] of changes) {
    const page = pages[number - 1];
    if (!page) throw new Error(`page ${number} does not exist (the PDF has ${pages.length} pages)`);
    const before = annotEntries(context, page.node);
    // Only our own stamps with valid data are replaced; foreign annotations and orphans stay, in order.
    const annots = before.filter((entry) => classifyAnnot(context, entry, ocgRef).kind !== "ours");
    if (change.payload !== null) annots.push(await createStamp(doc, page, change.payload, change.png!, ocg));
    if (change.payload === null && annots.length === before.length) continue; // nothing to remove
    if (annots.length > 0) page.node.set(PDFName.of("Annots"), context.obj(annots));
    else page.node.delete(PDFName.of("Annots"));
    changed.add(page.ref);
  }

  doc.catalog.set(
    PDFName.of(SMV_CATALOG_KEY),
    context.obj({ Version: MARKUP_FORMAT_VERSION, OriginalLength: meta.originalLength, UpdateStart: meta.updateStart }),
  );

  const created = context
    .enumerateIndirectObjects()
    .map(([ref]) => ref)
    .filter((ref) => ref.objectNumber >= firstNew);
  return writeIncrementalUpdate(base, context, [...changed.values(), ...created]).bytes;
}

/**
 * Returns `current` plus an incremental update with the markup `changes` applied. Pages not in
 * `changes` keep their stamps. Throws `EncryptedPDFError` (usable with `instanceof`) for encrypted PDFs.
 */
export async function buildMarkedPdf(current: Uint8Array, changes: PageChange[]): Promise<Uint8Array> {
  const byPage = normalizeChanges(changes);
  // Base selection (truncating our previous update instead of growing the file) is added here later;
  // for now every save appends to `current`.
  const base = current;
  const doc = await PDFDocument.load(base, { updateMetadata: false, ignoreEncryption: true });
  if (doc.isEncrypted) {
    // pdf-lib's ES5 build loses the subclass prototype of its own error, which breaks `instanceof`.
    throw Object.setPrototypeOf(new EncryptedPDFError(), EncryptedPDFError.prototype) as EncryptedPDFError;
  }
  reserveObjectNumbers(base, doc.context);
  const existing = readMarkup(doc);
  const meta: MarkupMeta = {
    originalLength: existing.meta?.originalLength ?? current.length,
    updateStart: base.length,
  };
  return appendMarkupUpdate(base, doc, existing.ocgRef, byPage, meta);
}
