/**
 * Fingerprint of a PDF's original bytes (spec: docs/superpowers/specs/2026-11-25-favorites-design.md).
 * Saving our markup appends an incremental update, so the fingerprint covers only the first
 * `/OriginalLength` bytes when the file carries our metadata, otherwise the whole file.
 * The definition is fixed: fingerprints are stored for good in the shared `.config.json`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isValidSectionEnd } from "./pdfMarkup/fileStructure";

export interface Fingerprint {
  sha256: string;
  length: number;
}

const METADATA = /\/OriginalLength\s+(\d+)\s*\/UpdateStart\s+(\d+)/g;

/**
 * Length of the original part: `n` of the last `/OriginalLength n /UpdateStart m` in the file with
 * `%%EOF` before `n` and `n <= m <= file length`; without such a match the whole file.
 */
export function originalLength(bytes: Uint8Array): number {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("latin1");
  let result = bytes.length;
  for (const match of text.matchAll(METADATA)) {
    const n = Number(match[1]);
    const m = Number(match[2]);
    if (isValidSectionEnd(bytes, n) && n <= m && m <= bytes.length) result = n;
  }
  return result;
}

export function fingerprintOf(bytes: Uint8Array): Fingerprint {
  const length = originalLength(bytes);
  const sha256 = createHash("sha256").update(bytes.subarray(0, length)).digest("hex");
  return { sha256, length };
}

const cache = new Map<string, { size: number; mtimeMs: number; fingerprint: Fingerprint }>();

/** Fingerprint of the PDF at `file`, cached per real path, size and mtime. Throws on I/O errors. */
export async function fingerprintFile(file: string): Promise<Fingerprint> {
  const real = await fs.promises.realpath(file);
  const { size, mtimeMs } = await fs.promises.stat(real);
  const hit = cache.get(real);
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.fingerprint;
  const fingerprint = fingerprintOf(await fs.promises.readFile(real));
  cache.set(real, { size, mtimeMs, fingerprint });
  return fingerprint;
}

/** For tests. */
export function clearFingerprintCache(): void {
  cache.clear();
}
