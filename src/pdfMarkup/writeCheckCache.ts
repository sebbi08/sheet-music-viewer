/**
 * Remembers, per PDF content, whether the trial build of a markup save succeeded (the write check on open).
 * The key is the content (SHA-256 and length), so a changed file misses the cache. The cache is only an
 * optimisation: an unreadable, broken or newer file counts as empty, and a failed write is swallowed.
 * No Electron imports: the caller passes the file path.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type CachedWriteCheck = { ok: true } | { ok: false; message: string };

export interface WriteCheckCache {
  get(key: string): Promise<CachedWriteCheck | undefined>;
  set(key: string, value: CachedWriteCheck): Promise<void>;
}

const FILE_VERSION = 1;

export function contentKey(bytes: Uint8Array): string {
  return `${createHash("sha256").update(bytes).digest("hex")}:${bytes.length}`;
}

function isEntry(value: unknown): value is CachedWriteCheck {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { ok?: unknown; message?: unknown };
  return v.ok === true || (v.ok === false && typeof v.message === "string");
}

async function readEntries(file: string): Promise<Map<string, CachedWriteCheck>> {
  const entries = new Map<string, CachedWriteCheck>();
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, "utf8"));
    if (parsed?.version !== FILE_VERSION || typeof parsed.entries !== "object" || parsed.entries === null) {
      return entries;
    }
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (isEntry(value)) entries.set(key, value);
    }
  } catch {
    // missing or broken: empty
  }
  return entries;
}

export function createFileWriteCheckCache(file: string, maxEntries = 1000): WriteCheckCache {
  return {
    async get(key) {
      return (await readEntries(file)).get(key);
    },
    async set(key, value) {
      const temp = path.join(path.dirname(file), `.${path.basename(file)}.smv-tmp`);
      try {
        const entries = await readEntries(file);
        entries.delete(key);
        entries.set(key, value);
        while (entries.size > maxEntries) {
          entries.delete(entries.keys().next().value as string);
        }
        await fs.promises.mkdir(path.dirname(file), { recursive: true });
        await fs.promises.writeFile(temp, JSON.stringify({ version: FILE_VERSION, entries: Object.fromEntries(entries) }));
        await fs.promises.rename(temp, file);
      } catch (e) {
        console.warn("Could not save the markup write check cache", e);
        await fs.promises.rm(temp, { force: true }).catch(() => undefined);
      }
    },
  };
}
