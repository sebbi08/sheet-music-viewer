/**
 * Read-only sheet folders (main): the bulk migration reports one once and then stays silent on every
 * start until it is writable again. Remembered locally (userData), never in the sheet folder. Electron-free.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { isFolderWritable } from "../pdfMarkup/folderProbe";

/** `readOnlyReport`: newly read-only, show it; `readOnlyKnown`: already shown, stay silent. */
export type FolderCheck = "writable" | "readOnlyReport" | "readOnlyKnown";

const stateSchema = z.object({ version: z.literal(1), folders: z.array(z.string()) });

/** Normalized (no trailing separator), case-insensitive on Windows. */
const key = (folder: string) => {
  const resolved = path.resolve(folder);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export class ReadOnlyFolders {
  private constructor(
    private readonly file: string,
    private folders: string[],
  ) {}

  static async load(file: string): Promise<ReadOnlyFolders> {
    try {
      const parsed = stateSchema.safeParse(JSON.parse(await fs.promises.readFile(file, "utf8")));
      if (parsed.success) return new ReadOnlyFolders(file, parsed.data.folders);
    } catch {
      // missing or broken: nothing reported yet
    }
    return new ReadOnlyFolders(file, []);
  }

  /** Checks `folder` and remembers a newly read-only one (forgets it once it is writable again). */
  async check(folder: string): Promise<FolderCheck> {
    const k = key(folder);
    const known = this.folders.includes(k);
    if (await isFolderWritable(folder)) {
      if (known) await this.save(this.folders.filter((f) => f !== k));
      return "writable";
    }
    if (known) return "readOnlyKnown";
    await this.save([...this.folders, k]);
    return "readOnlyReport";
  }

  /** A failed write is logged only: the worst case is the same report on the next start. */
  private async save(folders: string[]): Promise<void> {
    this.folders = folders;
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, folders }));
      await fs.promises.rename(tmp, this.file);
    } catch (e) {
      console.warn("Could not remember the read-only sheet folders", e);
    }
  }
}
