/** Which directory entries the sheet list shows: folders and PDFs, nothing hidden (leading dot). */
export function isListedSheetEntry(name: string, isDirectory: boolean): boolean {
  if (name.startsWith(".")) return false;
  return isDirectory || name.toLowerCase().endsWith(".pdf");
}
