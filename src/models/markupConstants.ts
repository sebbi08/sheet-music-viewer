/** Identifiers of the markup stored inside PDFs. No Node imports: also used by the renderer. */

/** Annotation key of the stream with the fabric data of a page. */
export const SMV_DATA_KEY = "SMV_Data";
/** Catalog key of our metadata dictionary (`/Version`, `/OriginalLength`, `/UpdateStart`). */
export const SMV_CATALOG_KEY = "SMV_Markup";
/** `/NM` of our stamp annotations. */
export const ANNOT_NM = "smv-markup-page";
/** `/NM` of stamps whose data was lost; they are kept as plain images. */
export const ORPHAN_NM = "smv-markup-orphan";
/** Name of our Optional Content Group. */
export const OCG_NAME = "Sheet Music Viewer – Markierungen";
export const MARKUP_FORMAT_VERSION = 1;
export const MARKUP_DPI = 300;
export const MAX_PNG_SIDE_PX = 4096;
