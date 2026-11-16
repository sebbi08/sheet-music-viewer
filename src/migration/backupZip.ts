import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { crc32 } from "zlib";
import yauzl from "yauzl";
import yazl from "yazl";
import type { MigrationCandidate } from "./types";

export type BackupResult =
  | {
      status: "ok";
      zipPath: string | null;
      included: MigrationCandidate[];
      excluded: { candidate: MigrationCandidate; message: string }[];
    }
  | { status: "error"; message: string }
  | { status: "cancelled" };

export interface ExpectedZipEntry {
  name: string;
  size: number;
  crc: number;
}

export interface BackupOptions {
  now: Date;
  signal?: AbortSignal;
  onProgress?(p: { doneBytes: number; totalBytes: number }): void;
}

class Cancelled extends Error {}

const TEMP_PATTERN = /^\.Markierungen-Backup-.*\.zip\.tmp$/;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const pad = (n: number) => String(n).padStart(2, "0");

function zipBaseName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Markierungen-Backup ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function freeZipPath(root: string, now: Date): string {
  const base = zipBaseName(now);
  for (let i = 1; ; i++) {
    const p = path.join(root, i === 1 ? `${base}.zip` : `${base} (${i}).zip`);
    if (!fs.existsSync(p)) return p;
  }
}

async function removeStaleTempFiles(root: string): Promise<void> {
  for (const name of await fs.promises.readdir(root)) {
    if (TEMP_PATTERN.test(name)) await fs.promises.rm(path.join(root, name), { force: true });
  }
}

/** Checks that the zip holds exactly the expected entries and that each one's size and CRC-32 match. */
export function verifyBackupZip(
  zipPath: string,
  expected: ExpectedZipEntry[],
  onEntryVerified?: (size: number) => void,
): Promise<void> {
  const want = new Map(expected.map((e) => [e.name, e]));
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr) return reject(openErr);
      const seen = new Set<string>();
      const fail = (e: Error) => {
        zip.close();
        reject(e);
      };
      zip.on("error", fail);
      zip.on("end", () => {
        if (seen.size !== want.size) return fail(new Error("Sicherung unvollständig"));
        zip.close();
        resolve();
      });
      zip.on("entry", (entry: yauzl.Entry) => {
        const exp = want.get(entry.fileName);
        if (!exp || seen.has(entry.fileName)) return fail(new Error(`Unerwarteter Eintrag ${entry.fileName}`));
        seen.add(entry.fileName);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return fail(streamErr);
          let crc = 0;
          let size = 0;
          stream.on("data", (chunk: Buffer) => {
            crc = crc32(chunk, crc);
            size += chunk.length;
          });
          stream.on("error", fail);
          stream.on("end", () => {
            if (size !== exp.size || crc !== exp.crc) return fail(new Error(`Prüfsumme stimmt nicht: ${exp.name}`));
            onEntryVerified?.(size);
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function writeZip(
  tempPath: string,
  files: { name: string; data: Buffer; compress: boolean }[],
): Promise<void> {
  const zip = new yazl.ZipFile();
  const out = fs.createWriteStream(tempPath, { flags: "wx" });
  const done = new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    zip.outputStream.on("error", reject);
    out.on("close", resolve);
  });
  zip.outputStream.pipe(out);
  for (const f of files) zip.addBuffer(f.data, f.name, { compress: f.compress });
  zip.end();
  await done;
  const fd = await fs.promises.open(tempPath, "r+");
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}

export async function createBackupZip(
  root: string,
  candidates: MigrationCandidate[],
  options: BackupOptions,
): Promise<BackupResult> {
  const tempPath = path.join(root, `.Markierungen-Backup-${randomBytes(6).toString("hex")}.zip.tmp`);
  const throwIfCancelled = () => {
    if (options.signal?.aborted) throw new Cancelled();
  };
  try {
    throwIfCancelled();
    await removeStaleTempFiles(root);

    const included: MigrationCandidate[] = [];
    const excluded: { candidate: MigrationCandidate; message: string }[] = [];
    const files: { name: string; data: Buffer; compress: boolean }[] = [];
    for (const candidate of candidates) {
      throwIfCancelled();
      const dir = path.posix.dirname(candidate.relativePath);
      const sidecarName = path.basename(candidate.sidecarPath);
      try {
        const pdf = await fs.promises.readFile(candidate.pdfPath);
        const sidecar = await fs.promises.readFile(candidate.sidecarPath);
        files.push(
          { name: candidate.relativePath, data: pdf, compress: false },
          { name: dir === "." ? sidecarName : `${dir}/${sidecarName}`, data: sidecar, compress: true },
        );
        included.push(candidate);
      } catch (e) {
        excluded.push({ candidate, message: messageOf(e) });
      }
    }
    if (included.length === 0) return { status: "ok", zipPath: null, included, excluded };

    throwIfCancelled();
    await writeZip(tempPath, files);

    const expected = files.map((f) => ({ name: f.name, size: f.data.length, crc: crc32(f.data) }));
    const totalBytes = expected.reduce((sum, e) => sum + e.size, 0);
    let doneBytes = 0;
    await verifyBackupZip(tempPath, expected, (size) => {
      doneBytes += size;
      options.onProgress?.({ doneBytes, totalBytes });
    });
    throwIfCancelled();

    const zipPath = freeZipPath(root, options.now);
    await fs.promises.rename(tempPath, zipPath);
    return { status: "ok", zipPath, included, excluded };
  } catch (e) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
    if (e instanceof Cancelled) return { status: "cancelled" };
    return { status: "error", message: messageOf(e) };
  }
}
