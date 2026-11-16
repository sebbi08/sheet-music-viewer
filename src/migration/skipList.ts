import fs from "fs";
import path from "path";
import type { FailureReason, MigrationCandidate } from "./types";

interface Fingerprint {
  size: number;
  mtimeMs: number;
}

interface SkipEntry {
  pdfPath: string;
  reason: FailureReason;
  pdf: Fingerprint;
  sidecar: Fingerprint;
}

const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

async function fingerprint(file: string): Promise<Fingerprint | undefined> {
  try {
    const st = await fs.promises.stat(file);
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return undefined;
  }
}

const same = (a: Fingerprint, b: Fingerprint | undefined) =>
  !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Files that failed permanently; skipped until the PDF or its sidecar changes. */
export class SkipList {
  private constructor(
    private readonly file: string,
    private entries: SkipEntry[],
  ) {}

  static async load(file: string): Promise<SkipList> {
    try {
      const json = JSON.parse(await fs.promises.readFile(file, "utf8"));
      if (json?.version === 1 && Array.isArray(json.entries)) {
        return new SkipList(file, json.entries as SkipEntry[]);
      }
    } catch {
      // missing or broken: start empty
    }
    return new SkipList(file, []);
  }

  async isSkipped(c: MigrationCandidate): Promise<boolean> {
    const entry = this.entries.find((e) => key(e.pdfPath) === key(c.pdfPath));
    if (!entry) return false;
    return (
      same(entry.pdf, await fingerprint(c.pdfPath)) &&
      same(entry.sidecar, await fingerprint(c.sidecarPath))
    );
  }

  async record(c: MigrationCandidate, reason: FailureReason): Promise<void> {
    const pdf = await fingerprint(c.pdfPath);
    const sidecar = await fingerprint(c.sidecarPath);
    if (!pdf || !sidecar) return;
    this.entries = this.entries.filter((e) => key(e.pdfPath) !== key(c.pdfPath));
    this.entries.push({ pdfPath: c.pdfPath, reason, pdf, sidecar });
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, entries: this.entries }));
    await fs.promises.rename(tmp, this.file);
  }
}
