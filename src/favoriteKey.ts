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

/**
 * The sheetKey of a PDF card in the folder view, by string operations only: `folderPath` is the view's path
 * below the sheet folder (starts and ends with `sep`, `sep` alone on the top level), `name` the file name.
 */
export function folderCardKey(folderPath: string, name: string, sep: string = window.path.sep): string {
  return [...folderPath.split(sep).filter((part) => part !== ""), name].join("/");
}
