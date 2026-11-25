/**
 * Renderer twin of `sheetKey` (src/folderConfig.ts): the PDF path relative to the sheet folder with "/",
 * `null` if it is not below the folder. Uses the preload's `window.path` (no Node import in the renderer).
 */
export function rendererSheetKey(
  folder: string,
  pdfPath: string,
  p: { relative(a: string, b: string): string; sep: string } = window.path,
): string | null {
  const rel = p.relative(folder, pdfPath);
  if (rel === "" || rel === ".." || rel.startsWith(".." + p.sep)) return null;
  // Another drive on Windows: `relative` returns an absolute path.
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel) || rel.startsWith("\\\\")) return null;
  return rel.split(p.sep).join("/");
}
