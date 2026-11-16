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
      // Settle only once yauzl really closed the file descriptor (the caller renames or deletes next).
      let outcome: { error?: Error } | undefined;
      zip.once("close", () => (outcome?.error ? reject(outcome.error) : resolve()));
      const fail = (e: Error) => {
        outcome ??= { error: e };
        zip.close();
      };
      zip.on("error", fail);
      zip.on("end", () => {
        if (seen.size !== want.size) return fail(new Error("Sicherung unvollständig"));
        outcome ??= {};
        zip.close();
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

interface PlannedFile {
  name: string;
  realPath: string;
  compress: boolean;
}

/** Streams a file once; returns its size and CRC-32 without holding it in memory. */
async function checksumFile(
  file: string,
  onChunk: (bytes: number) => void,
  throwIfCancelled: () => void,
): Promise<{ size: number; crc: number }> {
  let crc = 0;
  let size = 0;
  for await (const chunk of fs.createReadStream(file) as AsyncIterable<Buffer>) {
    throwIfCancelled();
    crc = crc32(chunk, crc);
    size += chunk.length;
    onChunk(chunk.length);
  }
  return { size, crc };
}

const closed = (stream: fs.ReadStream | fs.WriteStream): Promise<void> =>
  new Promise((resolve) => {
    if (stream.closed) return resolve();
    stream.once("close", () => resolve());
    stream.destroy();
  });

async function writeZip(
  tempPath: string,
  files: PlannedFile[],
  onBytes: (bytes: number) => void,
  throwIfCancelled: () => void,
): Promise<void> {
  const zip = new yazl.ZipFile();
  const out = fs.createWriteStream(tempPath, { flags: "wx" });
  let current: fs.ReadStream | undefined;
  let failed = false;
  const done = new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      try {
        throwIfCancelled();
      } catch (e) {
        return fail(e as Error);
      }
      onBytes(chunk.length);
    };
    // Stops everything (output, current source, further sources) and rejects only once all handles are closed.
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      zip.outputStream.off("data", onData);
      zip.outputStream.unpipe(out);
      zip.outputStream.destroy();
      void Promise.all([closed(out), current ? closed(current) : undefined]).then(() => reject(e));
    };
    out.on("error", fail);
    zip.on("error", fail);
    zip.outputStream.on("error", fail);
    zip.outputStream.on("data", onData);
    out.on("close", () => {
      if (!failed) resolve();
    });
  });
  zip.outputStream.pipe(out);
  // Sources are opened lazily, one entry at a time, with back-pressure from the output.
  for (const f of files) {
    zip.addReadStreamLazy(f.name, { compress: f.compress }, (cb) => {
      if (failed) return cb(new Error("aborted"));
      current = fs.createReadStream(f.realPath);
      cb(null, current);
    });
  }
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

    // Phase weights: checksum pass, write, verify (each counts the included bytes once).
    const sized: { candidate: MigrationCandidate; pdfSize: number; sidecarSize: number }[] = [];
    const excluded: { candidate: MigrationCandidate; message: string }[] = [];
    for (const candidate of candidates) {
      try {
        const pdfSize = (await fs.promises.stat(candidate.pdfPath)).size;
        const sidecarSize = (await fs.promises.stat(candidate.sidecarPath)).size;
        sized.push({ candidate, pdfSize, sidecarSize });
      } catch (e) {
        excluded.push({ candidate, message: messageOf(e) });
      }
    }
    const totalBytes = sized.reduce((sum, s) => sum + s.pdfSize + s.sidecarSize, 0) * 3;
    let doneBytes = 0;
    const advance = (bytes: number) => {
      doneBytes = Math.min(totalBytes, doneBytes + bytes);
      options.onProgress?.({ doneBytes, totalBytes });
    };

    const included: MigrationCandidate[] = [];
    const planned: PlannedFile[] = [];
    const expected: ExpectedZipEntry[] = [];
    for (const { candidate, pdfSize, sidecarSize } of sized) {
      throwIfCancelled();
      const dir = path.posix.dirname(candidate.relativePath);
      const sidecarName = path.basename(candidate.sidecarPath);
      const sidecarEntry = dir === "." ? sidecarName : `${dir}/${sidecarName}`;
      let pdf: { size: number; crc: number };
      let sidecar: { size: number; crc: number };
      try {
        pdf = await checksumFile(candidate.pdfPath, advance, throwIfCancelled);
        sidecar = await checksumFile(candidate.sidecarPath, advance, throwIfCancelled);
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        excluded.push({ candidate, message: messageOf(e) });
        advance(3 * (pdfSize + sidecarSize));
        continue;
      }
      included.push(candidate);
      planned.push(
        { name: candidate.relativePath, realPath: candidate.pdfPath, compress: false },
        { name: sidecarEntry, realPath: candidate.sidecarPath, compress: true },
      );
      expected.push(
        { name: candidate.relativePath, ...pdf },
        { name: sidecarEntry, ...sidecar },
      );
    }
    if (included.length === 0) return { status: "ok", zipPath: null, included, excluded };

    throwIfCancelled();
    await writeZip(tempPath, planned, advance, throwIfCancelled);
    await verifyBackupZip(tempPath, expected, advance);
    throwIfCancelled();
    advance(totalBytes); // sizes may have shifted slightly; always finish at 100 %

    const zipPath = freeZipPath(root, options.now);
    await fs.promises.rename(tempPath, zipPath);
    return { status: "ok", zipPath, included, excluded };
  } catch (e) {
    await fs.promises.rm(tempPath, { force: true }).catch((rmErr) => {
      console.error(`Could not remove temporary backup file ${tempPath}:`, rmErr);
    });
    if (e instanceof Cancelled) return { status: "cancelled" };
    return { status: "error", message: messageOf(e) };
  }
}
