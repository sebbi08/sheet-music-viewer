/**
 * Writes markup into a PDF as an incremental update (spec sections 1–5): per page one Stamp annotation
 * with a PNG appearance, the fabric data in a hidden `/SMV_Data` stream and `/OC` pointing at our
 * Optional Content Group; the catalog gets `/SMV_Markup` metadata. Our previous update is replaced
 * while it is the last one, so the file does not grow; the original bytes are never changed.
 */
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFRef,
  PDFString,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import { markupPayloadSchema, type MarkupPayload, type Rect } from "../models/markup";
import {
  ANNOT_NM,
  MARKUP_FORMAT_VERSION,
  OCG_NAME,
  ORPHAN_NM,
  SMV_CATALOG_KEY,
  SMV_DATA_KEY,
} from "../models/markupConstants";
import { findLastStartXref, getSectionTrailer, isValidSectionEnd } from "./fileStructure";
import { reserveObjectNumbers, writeIncrementalUpdate } from "./incrementalWriter";
import { annotEntries, readMarkup, visiblePageRect, type ExistingMarkupPage, type MarkupMeta } from "./readMarkup";

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

const sameRef = (a: PDFObject | undefined, b: PDFRef | null | undefined) =>
  b != null && a instanceof PDFRef && a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber;

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

/** `/Rotate` of a page, inherited through `/Parent`; anything but a number counts as 0 (like pdf.js). */
function pageRotation(doc: PDFDocument, pageNode: PDFDict): number {
  const deref = (object: PDFObject | undefined) => (object instanceof PDFRef ? doc.context.lookup(object) : object);
  const seen = new Set<PDFDict>();
  for (let cur: PDFObject | undefined = pageNode; cur instanceof PDFDict && !seen.has(cur); ) {
    seen.add(cur);
    const value = cur.get(PDFName.of("Rotate"));
    if (value !== undefined) {
      const rotate = deref(value);
      return rotate instanceof PDFNumber ? rotate.asNumber() : 0;
    }
    cur = deref(cur.get(PDFName.of("Parent")));
  }
  return 0;
}

/** Registers our stamp annotation (fixed key order, so a re-created stamp has the same size). */
function registerStamp(
  doc: PDFDocument,
  page: PDFPage,
  rect: Rect,
  appearance: PDFRef,
  data: PDFRef,
  ocgRef: PDFRef,
): PDFRef {
  const { context } = doc;
  return context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Stamp",
      Rect: rect,
      F: 4,
      NM: PDFString.of(ANNOT_NM),
      AP: { N: appearance },
      OC: ocgRef,
      P: page.ref,
      [SMV_DATA_KEY]: data,
    }),
  );
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
  const matrix = rotationMatrix(pageRotation(doc, page.node), w, h).map(num).join(" ");
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
  return registerStamp(doc, page, rect, form, data, ocgRef);
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

/** Number of `startxref` keywords in `bytes[from..)`. */
function countStartXref(bytes: Uint8Array, from: number): number {
  const tail = Buffer.from(bytes.buffer, bytes.byteOffset + from, bytes.length - from);
  let count = 0;
  for (let at = tail.indexOf("startxref"); at >= 0; at = tail.indexOf("startxref", at + 1)) count++;
  return count;
}

/**
 * True iff the file's last cross-reference section is a single update starting at `updateStart`: a
 * section ends (`%%EOF`) at `updateStart`, exactly one section (`startxref`) follows, the last
 * `startxref` points at or after `updateStart` and that section's `/Prev` points before it. A last
 * section without `/Prev` is never ours (we always write one).
 */
export function isOurUpdateLast(bytes: Uint8Array, updateStart: number): boolean {
  if (!isValidSectionEnd(bytes, updateStart)) return false;
  // A later section whose /Prev (non-conformingly) skips ours must not be cut off.
  if (countStartXref(bytes, updateStart) !== 1) return false;
  try {
    const last = findLastStartXref(bytes);
    if (last < updateStart) return false;
    const { prev } = getSectionTrailer(bytes, last);
    return prev !== null && prev < updateStart;
  } catch {
    return false;
  }
}

/**
 * Where to write (spec section 1). `originalLength` is the stored original length if a section still
 * ends there, otherwise the whole file (first save, or another program rewrote the file).
 * `baseLength` is the prefix of `current` the new update is appended to: the start of our previous
 * update if that is still the last one (replace, the file does not grow), otherwise the whole file.
 */
export function chooseBase(
  current: Uint8Array,
  meta: MarkupMeta | null,
): { baseLength: number; originalLength: number } {
  if (!meta || !isValidSectionEnd(current, meta.originalLength))
    return { baseLength: current.length, originalLength: current.length };
  // Never cut into the original, whatever the metadata says.
  const replace = meta.updateStart >= meta.originalLength && isOurUpdateLast(current, meta.updateStart);
  return { baseLength: replace ? meta.updateStart : current.length, originalLength: meta.originalLength };
}

async function loadUnencrypted(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  if (doc.isEncrypted) {
    // pdf-lib's ES5 build loses the subclass prototype of its own error, which breaks `instanceof`.
    throw Object.setPrototypeOf(new EncryptedPDFError(), EncryptedPDFError.prototype) as EncryptedPDFError;
  }
  return doc;
}

/** What a page shows after the save. */
type Target =
  | { kind: "new"; payload: MarkupPayload; png: Uint8Array }
  | { kind: "keep"; markup: ExistingMarkupPage }
  | { kind: "none" };

/**
 * Returns a valid prefix of `current` (the original plus foreign updates) plus one incremental update
 * with the markup `changes` applied; pages not in `changes` keep the markup `current` shows. Our previous
 * update is replaced while it is the last one, foreign updates are kept. Orphaned stamps are repaired
 * (taken out of our OCG, renamed), never removed. When no markup is left, the original bytes are
 * returned. Throws `EncryptedPDFError` (usable with `instanceof`) for encrypted PDFs.
 */
export async function buildMarkedPdf(current: Uint8Array, changes: PageChange[]): Promise<Uint8Array> {
  const byPage = normalizeChanges(changes);
  const full = await loadUnencrypted(current);
  const shown = readMarkup(full); // the state the user sees, including our previous update
  const { baseLength, originalLength } = chooseBase(current, shown.meta);

  const base = current.subarray(0, baseLength);
  const doc = baseLength === current.length ? full : await loadUnencrypted(base);
  reserveObjectNumbers(base, doc.context); // before any object is created or copied
  const existing = doc === full ? shown : readMarkup(doc); // what the base itself contains
  const { context } = doc;

  const pages = doc.getPages();
  for (const number of byPage.keys())
    if (number > pages.length) throw new Error(`page ${number} does not exist (the PDF has ${pages.length} pages)`);

  const targets = new Map<number, Target>();
  for (const markup of shown.pages) targets.set(markup.page, { kind: "keep", markup });
  for (const [number, { payload, png }] of byPage)
    targets.set(number, payload ? { kind: "new", payload, png: png! } : { kind: "none" });

  const anyMarkup = [...targets.values()].some((t) => t.kind !== "none");
  if (!anyMarkup && existing.pages.length === 0 && existing.orphans.length === 0 && baseLength === originalLength)
    return current.slice(0, originalLength); // everything removed: back to the original bytes

  const firstNew = context.largestObjectNumber + 1;
  const changed = new ChangedRefs();
  changed.add(context.trailerInfo.Root as PDFRef);
  const ocg = ensureOcg(doc, existing.ocgRef, changed);

  // Orphans stay visible as plain images: out of our OCG (hidden in the app) and renamed, so they are
  // foreign from now on. A foreign /OC (another program's layer) is respected.
  for (const { annotRef } of existing.orphans) {
    const annot = context.lookup(annotRef, PDFDict);
    if (sameRef(annot.get(PDFName.of("OC")), existing.ocgRef)) annot.delete(PDFName.of("OC"));
    annot.set(PDFName.of("NM"), PDFString.of(ORPHAN_NM));
    changed.add(annotRef);
  }

  const copier = PDFObjectCopier.for(full.context, context);
  const inBase = new Map(existing.pages.map((p) => [p.page, p.annotRef]));
  for (const [index, page] of pages.entries()) {
    const target = targets.get(index + 1) ?? { kind: "none" };
    const ours = inBase.get(index + 1);
    // Unchanged and present in the base (always the case when appending): leave the page alone.
    if (target.kind === "keep" && sameRef(target.markup.annotRef, ours)) continue;
    if (target.kind === "none" && !ours) continue;

    // Foreign annotations, direct dictionaries and orphans stay, in order; only our stamp is replaced.
    const annots = annotEntries(context, page.node).filter((entry) => !sameRef(entry, ours));
    if (target.kind === "new") annots.push(await createStamp(doc, page, target.payload, target.png, ocg));
    if (target.kind === "keep") {
      // The stamp was in our replaced update: take it over from the full file, at its previous rect.
      const { rect, appearanceRef, dataRef } = target.markup;
      annots.push(registerStamp(doc, page, rect, copier.copy(appearanceRef), copier.copy(dataRef), ocg));
    }
    if (annots.length > 0) page.node.set(PDFName.of("Annots"), context.obj(annots));
    else page.node.delete(PDFName.of("Annots"));
    changed.add(page.ref);
  }

  doc.catalog.set(
    PDFName.of(SMV_CATALOG_KEY),
    context.obj({ Version: MARKUP_FORMAT_VERSION, OriginalLength: originalLength, UpdateStart: baseLength }),
  );

  const created = context
    .enumerateIndirectObjects()
    .map(([ref]) => ref)
    .filter((ref) => ref.objectNumber >= firstNew);
  return writeIncrementalUpdate(base, context, [...changed.values(), ...created]).bytes;
}
