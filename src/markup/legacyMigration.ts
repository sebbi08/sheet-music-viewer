import type { LoadedMarkupPage, MarkupPayload } from "../models/markup";
import { markupPayloadSchema } from "../models/markup";
import type { OverlayData } from "../models/types";
import { legacyToPayload, rotatePayload } from "./fabricTransform";
import type { PageState } from "./saveQueue";

type PageViewport = { width: number; height: number; rotation: number };

/** Displayed page size in points and its display rotation (a pdf.js viewport at scale 1 will do). */
export type ViewportOf = (page: number) => Promise<PageViewport>;

/** null if the entry cannot be converted into a valid payload. */
function toLegacyPayload(entry: OverlayData, objects: unknown, viewport: PageViewport): MarkupPayload | null {
  const validSize = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!Array.isArray(objects) || !validSize(entry.drawWidth) || !validSize(entry.drawHeight)) return null;
  try {
    const parsed = markupPayloadSchema.safeParse(legacyToPayload(entry, viewport));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Old `.data` file (screen pixels + drawWidth/drawHeight) -> pages in points (spec section 7). Pure: the
 * caller decides what to show and queue. `unreadable`: some part could not be read (the readable pages are
 * still returned); the legacy file must then not be deleted. `skipPages` (unsaved changes) produce no change.
 */
export async function convertLegacyOverlayData(
  text: string,
  numPages: number,
  viewportOf: ViewportOf,
  skipPages: ReadonlySet<number> = new Set(),
): Promise<{ changes: [number, PageState][]; unreadable: boolean }> {
  let entries: unknown = null;
  try {
    // The old app treated an empty file as no markup.
    entries = text.trim() === "" ? [] : JSON.parse(text);
  } catch (e) {
    console.warn("Could not parse the legacy markup file", e);
  }
  if (!Array.isArray(entries)) return { changes: [], unreadable: true };

  let unreadable = false;
  const seen = new Set<number>();
  const changes: [number, PageState][] = [];
  for (const raw of entries as unknown[]) {
    const entry = raw as Partial<OverlayData> | null;
    const page = entry?.page;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) {
      unreadable = true;
      continue;
    }
    // Like the old edit mode, the first entry of a page wins; pages the PDF lacks were never shown.
    if (page > numPages || seen.has(page)) continue;
    seen.add(page);
    if (skipPages.has(page)) continue;
    const objects = (entry?.data as { objects?: unknown } | undefined)?.objects;
    if (objects === undefined || (Array.isArray(objects) && objects.length === 0)) {
      changes.push([page, null]); // no markup on this page
      continue;
    }
    const payload = toLegacyPayload(entry as OverlayData, objects, await viewportOf(page));
    if (!payload) {
      unreadable = true;
      continue;
    }
    changes.push([page, { rect: null, payload }]);
  }
  return { changes, unreadable };
}

/** Pages of a v1 sidecar in the current page rotation, ready to be written into the PDF. */
export async function sidecarPagesToChanges(
  pages: LoadedMarkupPage[],
  numPages: number,
  viewportOf: ViewportOf,
  skipPages: ReadonlySet<number> = new Set(),
): Promise<[number, PageState][]> {
  const changes: [number, PageState][] = [];
  for (const { page, rect, payload } of pages) {
    if (page > numPages || skipPages.has(page)) continue;
    const viewport = await viewportOf(page);
    changes.push([page, { rect, payload: rotatePayload(payload, viewport.rotation) }]);
  }
  return changes;
}

/** Whether any change carries markup (a `null` page only clears). */
export function hasMarkup(changes: [number, PageState][]): boolean {
  return changes.some(([, state]) => state !== null);
}
