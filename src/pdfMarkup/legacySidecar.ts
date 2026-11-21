/**
 * The old app's `.<name>.data` markup file: its exact name rule and a reader that classifies the content
 * without ever mistaking a read error for "no file". No Electron imports: unit-tested in Node.
 */
import fs from "node:fs";
import path from "node:path";
import { sidecarV1Schema, type MarkupPayload } from "../models/markup";

/**
 * `.<name>.data` next to the PDF. Literal port of the old app's `getOverlayDataFilePathFromSheetPath`
 * (`src/trcpLib.ts`, v1.15.1), quirks included: `String.replace` with a string pattern replaces the first
 * occurrence in the whole path and interprets `$` patterns in the replacement, so existing files are found.
 */
export function getSidecarPath(pdfPath: string): string {
  const base = path.basename(pdfPath);
  const name = "." + base.replace(path.extname(base), ".data");
  return pdfPath.replace(base, name);
}

export type SidecarContent =
  | { kind: "gone" } // ENOENT
  | { kind: "unreadable"; message: string } // any other read error
  | { kind: "empty" } // no markup
  | { kind: "legacy"; text: string }
  | { kind: "v1"; pages: { page: number; payload: MarkupPayload }[] };

/**
 * Whether the text of a legacy `.data` file holds markup. Empty text, `[]` and pages without objects do
 * not; anything unreadable counts as markup, so such a file is never deleted.
 */
export function legacySidecarHasMarkup(text: string): boolean {
  if (text.trim() === "") return false;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return true;
  }
  if (!Array.isArray(json)) return true;
  return json.some((entry: unknown) => {
    const data = entry !== null && typeof entry === "object" ? (entry as { data?: unknown }).data : undefined;
    const objects = data !== null && typeof data === "object" ? (data as { objects?: unknown }).objects : undefined;
    return !(Array.isArray(objects) && objects.length === 0);
  });
}

/** Reads and classifies the sidecar of `pdfPath`. Only ENOENT means "gone"; other read errors are reported. */
export async function readSidecarContent(pdfPath: string): Promise<SidecarContent> {
  let text: string;
  try {
    text = await fs.promises.readFile(getSidecarPath(pdfPath), "utf8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return { kind: "gone" };
    return { kind: "unreadable", message: e instanceof Error ? e.message : String(e) };
  }
  if (text.trim() === "") return { kind: "empty" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return legacySidecarHasMarkup(text) ? { kind: "legacy", text } : { kind: "empty" };
  }
  const v1 = sidecarV1Schema.safeParse(json);
  if (v1.success) return v1.data.pages.length > 0 ? { kind: "v1", pages: v1.data.pages } : { kind: "empty" };
  return legacySidecarHasMarkup(text) ? { kind: "legacy", text } : { kind: "empty" };
}
