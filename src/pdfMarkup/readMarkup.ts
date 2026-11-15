/**
 * Finds our markup in a loaded PDF: one Stamp annotation per page (`/NM (smv-markup-page)`) whose
 * `/SMV_Data` stream holds the fabric JSON, our Optional Content Group and the catalog metadata.
 * Never throws on foreign or broken content: stamps of ours without usable data are reported as orphans.
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFDocument,
} from "pdf-lib";
import { markupPayloadSchema, type MarkupPayload, type Rect } from "../models/markup";
import {
  ANNOT_NM,
  MARKUP_FORMAT_VERSION,
  OCG_NAME,
  SMV_CATALOG_KEY,
  SMV_DATA_KEY,
} from "../models/markupConstants";

export interface ExistingMarkupPage {
  page: number;
  pageRef: PDFRef;
  annotRef: PDFRef;
  rect: Rect;
  payload: MarkupPayload;
  appearanceRef: PDFRef;
  dataRef: PDFRef;
}

export interface MarkupMeta {
  originalLength: number;
  updateStart: number;
}

export interface ReadMarkupResult {
  pages: ExistingMarkupPage[];
  orphans: { page: number; annotRef: PDFRef }[];
  meta: MarkupMeta | null;
  ocgRef: PDFRef | null;
}

const name = (key: string) => PDFName.of(key);

/** Lookup that yields `undefined` instead of throwing for broken references. */
function lookup(context: PDFContext, object: PDFObject | undefined): PDFObject | undefined {
  try {
    return object instanceof PDFRef ? context.lookup(object) : object;
  } catch {
    return undefined;
  }
}

function decodeText(object: PDFObject | undefined): string | undefined {
  return object instanceof PDFString || object instanceof PDFHexString ? object.decodeText() : undefined;
}

/** `[x0, y0, x1, y1]` of a 4-number array, normalized; `null` if malformed. */
function toRect(context: PDFContext, object: PDFObject | undefined): Rect | null {
  if (!(object instanceof PDFArray) || object.size() !== 4) return null;
  const n = object.asArray().map((item) => lookup(context, item));
  if (!n.every((item): item is PDFNumber => item instanceof PDFNumber)) return null;
  const [a, b, c, d] = n.map((item) => item.asNumber());
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

const hasArea = (r: Rect) => r[2] - r[0] > 0 && r[3] - r[1] > 0;

/** A page box (`MediaBox`, `CropBox`), inherited through `/Parent` like pdf.js does; `null` if absent or empty. */
function inheritedBox(context: PDFContext, node: PDFDict, key: "MediaBox" | "CropBox"): Rect | null {
  const seen = new Set<PDFDict>();
  for (let cur: PDFObject | undefined = node; cur instanceof PDFDict && !seen.has(cur); ) {
    seen.add(cur);
    const value = cur.get(name(key));
    if (value !== undefined) {
      const rect = toRect(context, lookup(context, value));
      return rect && hasArea(rect) ? rect : null;
    }
    cur = lookup(context, cur.get(name("Parent")));
  }
  return null;
}

const LETTER: Rect = [0, 0, 612, 792];

/**
 * The visible page area in unrotated user space: CropBox ∩ MediaBox (inherited boxes respected), with
 * pdf.js' fallbacks (missing MediaBox → Letter, missing CropBox or empty intersection → MediaBox).
 */
export function visiblePageRect(context: PDFContext, pageNode: PDFDict): Rect {
  const media = inheritedBox(context, pageNode, "MediaBox") ?? LETTER;
  const crop = inheritedBox(context, pageNode, "CropBox");
  if (!crop) return media;
  const box: Rect = [
    Math.max(crop[0], media[0]),
    Math.max(crop[1], media[1]),
    Math.min(crop[2], media[2]),
    Math.min(crop[3], media[3]),
  ];
  return hasArea(box) ? box : media;
}

/** The raw entries of a page's `/Annots` (references or, rarely, direct dictionaries). */
export function annotEntries(context: PDFContext, pageNode: PDFDict): PDFObject[] {
  const annots = lookup(context, pageNode.get(name("Annots")));
  return annots instanceof PDFArray ? annots.asArray() : [];
}

/** Our OCG in `/OCProperties /OCGs`, found by its decoded `/Name`. */
export function findOcg(doc: PDFDocument): PDFRef | null {
  const { context } = doc;
  const props = lookup(context, doc.catalog.get(name("OCProperties")));
  if (!(props instanceof PDFDict)) return null;
  const ocgs = lookup(context, props.get(name("OCGs")));
  if (!(ocgs instanceof PDFArray)) return null;
  for (const entry of ocgs.asArray()) {
    if (!(entry instanceof PDFRef)) continue;
    const ocg = lookup(context, entry);
    if (ocg instanceof PDFDict && decodeText(lookup(context, ocg.get(name("Name")))) === OCG_NAME) return entry;
  }
  return null;
}

/** Parses the fabric data stream; `null` for anything that is not a valid payload. */
function readPayload(context: PDFContext, stream: PDFObject | undefined): MarkupPayload | null {
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(decodePDFRawStream(stream).decode());
    const result = markupPayloadSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const sameRef = (a: PDFObject | undefined, b: PDFRef | null) =>
  b !== null && a instanceof PDFRef && a.objectNumber === b.objectNumber && a.generationNumber === b.generationNumber;

export type AnnotKind =
  | { kind: "ours"; rect: Rect; payload: MarkupPayload; appearanceRef: PDFRef; dataRef: PDFRef }
  | { kind: "orphan" }
  | { kind: "foreign" };

/**
 * Ours: `/NM (smv-markup-page)`, a valid `/Rect`, `/AP /N` reference and a readable `/SMV_Data` stream.
 * Orphan: our `/NM` or `/OC` pointing at our OCG, but not all of the above. A repaired orphan
 * (`/NM (smv-markup-orphan)` without `/OC`) counts as foreign: it is a plain image that needs no further
 * repair; while it still points at our OCG it remains an orphan.
 */
export function classifyAnnot(context: PDFContext, entry: PDFObject, ocgRef: PDFRef | null): AnnotKind {
  const annot = lookup(context, entry);
  if (!(annot instanceof PDFDict)) return { kind: "foreign" };
  const nm = decodeText(lookup(context, annot.get(name("NM"))));
  if (nm !== ANNOT_NM && !sameRef(annot.get(name("OC")), ocgRef)) return { kind: "foreign" };
  if (nm !== ANNOT_NM) return { kind: "orphan" };

  const rect = toRect(context, lookup(context, annot.get(name("Rect"))));
  const ap = lookup(context, annot.get(name("AP")));
  const appearanceRef = ap instanceof PDFDict ? ap.get(name("N")) : undefined;
  const dataRef = annot.get(name(SMV_DATA_KEY));
  if (!rect || !hasArea(rect) || !(appearanceRef instanceof PDFRef) || !(dataRef instanceof PDFRef))
    return { kind: "orphan" };
  const payload = readPayload(context, lookup(context, dataRef));
  return payload ? { kind: "ours", rect, payload, appearanceRef, dataRef } : { kind: "orphan" };
}

function readMeta(doc: PDFDocument): MarkupMeta | null {
  const { context } = doc;
  const meta = lookup(context, doc.catalog.get(name(SMV_CATALOG_KEY)));
  if (!(meta instanceof PDFDict)) return null;
  const num = (key: string) => {
    const value = lookup(context, meta.get(name(key)));
    return value instanceof PDFNumber ? value.asNumber() : NaN;
  };
  const [version, originalLength, updateStart] = [num("Version"), num("OriginalLength"), num("UpdateStart")];
  const isOffset = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (version !== MARKUP_FORMAT_VERSION || !isOffset(originalLength) || !isOffset(updateStart)) return null;
  return { originalLength, updateStart };
}

/**
 * Reads our stamps (at most one per page: if a page has several valid ones, the topmost, i.e. last in
 * `/Annots`, wins), orphaned stamps, `/SMV_Markup` metadata and our OCG. Only referenced annotations are
 * considered (ours are always indirect objects).
 */
export function readMarkup(doc: PDFDocument): ReadMarkupResult {
  const { context } = doc;
  const ocgRef = findOcg(doc);
  const pages: ExistingMarkupPage[] = [];
  const orphans: ReadMarkupResult["orphans"] = [];
  doc.getPages().forEach((page, index) => {
    let found: ExistingMarkupPage | null = null;
    for (const entry of annotEntries(context, page.node)) {
      if (!(entry instanceof PDFRef)) continue;
      const result = classifyAnnot(context, entry, ocgRef);
      if (result.kind === "orphan") orphans.push({ page: index + 1, annotRef: entry });
      if (result.kind !== "ours") continue;
      const { rect, payload, appearanceRef, dataRef } = result;
      found = { page: index + 1, pageRef: page.ref, annotRef: entry, rect, payload, appearanceRef, dataRef };
    }
    if (found) pages.push(found);
  });
  return { pages, orphans, meta: readMeta(doc), ocgRef };
}
