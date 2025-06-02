import { SheetFile } from "./models/types";

export function fileNameWithoutExtension(fileName: string): string {
  const indexOfExtension = fileName.lastIndexOf(".");
  if (indexOfExtension === -1) return fileName;
  return fileName.slice(0, indexOfExtension);
}

export function sortAndFilterFile(files?: SheetFile[]): SheetFile[] {
  return (
    files
      ?.filter((item) => {
        if (item.isFile) {
          return item.name.toLowerCase().endsWith(".pdf");
        }
        return true;
      })
      .sort((a, b) => {
        if (a.isFile && !b.isFile) {
          return 1;
        }
        if (!a.isFile && b.isFile) {
          return -1;
        }
        return a.name.localeCompare(b.name);
      }) || []
  );
}
