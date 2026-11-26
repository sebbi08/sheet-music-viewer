/**
 * Write probe for a folder (main): used by the markup file layer on every write check and save (the
 * temp file and the rename need the folder), and so by both passes of the migration gate. Electron-free.
 */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { retryWhileLocked } from "./lockRetry";

const READ_ONLY_CODES = new Set(["EACCES", "EPERM", "EROFS"]);
const isReadOnlyError = (e: unknown) =>
  e instanceof Error && "code" in e && READ_ONLY_CODES.has(String((e as NodeJS.ErrnoException).code));

/**
 * The folder accepts new files. `access` alone is not enough on Windows (it ignores folder ACLs), so a
 * probe named like the backup's temp file is created and removed again, retried while another program (a
 * virus scanner, a sync client) holds it; a probe that still stays is only logged. Errors other than a
 * denied write count as writable: the write that follows then reports them.
 */
export async function isFolderWritable(folder: string): Promise<boolean> {
  try {
    await fs.promises.access(folder, fs.constants.W_OK);
    const probe = path.join(folder, `.Markierungen-Backup-${randomBytes(6).toString("hex")}.zip.tmp`);
    const handle = await fs.promises.open(probe, "wx");
    await handle.close();
    await retryWhileLocked(() => fs.promises.rm(probe, { force: true })).catch((e: unknown) => {
      console.warn(`Could not remove the write probe ${probe}:`, e);
    });
    return true;
  } catch (e) {
    return !isReadOnlyError(e);
  }
}
