/**
 * Sheet folders whose legacy markup is migrated (main): once a gate run ends without a single error the
 * folder is remembered here and its `.data` files are never looked at again. Remembered locally
 * (userData), never in the sheet folder. Electron-free.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";

const stateSchema = z.object({ version: z.literal(1), folders: z.array(z.string()) });

/** Normalized (no trailing separator), case-insensitive on Windows. */
const key = (folder: string) => {
  // path.win32 is what `path` is on Windows; it also lets tests simulate that platform on Linux.
  if (process.platform === "win32") return path.win32.resolve(folder).toLowerCase();
  return path.resolve(folder);
};

export class MigratedFolders {
  private constructor(
    private readonly file: string,
    private folders: string[],
  ) {}

  /** A missing or broken file means nothing is migrated yet. */
  static async load(file: string): Promise<MigratedFolders> {
    try {
      const parsed = stateSchema.safeParse(JSON.parse(await fs.promises.readFile(file, "utf8")));
      if (parsed.success) return new MigratedFolders(file, parsed.data.folders);
    } catch {
      // missing or broken: nothing migrated yet
    }
    return new MigratedFolders(file, []);
  }

  has(folder: string): boolean {
    return this.folders.includes(key(folder));
  }

  /** A failed write is logged only: the worst case is one more gate run on the next start. */
  async add(folder: string): Promise<void> {
    const k = key(folder);
    if (this.folders.includes(k)) return;
    this.folders = [...this.folders, k];
    try {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, folders: this.folders }));
      await fs.promises.rename(tmp, this.file);
    } catch (e) {
      console.warn("Could not remember the migrated sheet folders", e);
    }
  }
}
