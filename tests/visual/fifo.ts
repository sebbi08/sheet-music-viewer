import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * A file the app reads that answers only when the test says so: a named pipe (FIFO). Reading it blocks in
 * the app's main process until `release` writes the content; afterwards a regular file with the same
 * content replaces the pipe, so later reads see it at once. POSIX only (`mkfifo`); tests using it skip on
 * Windows.
 */
export interface HeldFile {
  /**
   * Waits (up to `timeoutMs`) until a reader has the pipe open, writes `text` to it and replaces the pipe
   * by a regular file with `text`. Throws when no reader came.
   */
  release(text: string, timeoutMs?: number): Promise<void>;
  /** Unblocks a waiting reader with empty content (for cleanups); never throws. */
  abandon(): void;
}

export const fifoSupported = process.platform !== "win32";

export function holdFile(file: string): HeldFile {
  fs.rmSync(file, { force: true });
  execFileSync("mkfifo", [file]);
  let released = false;
  /** Writes `text` to a reader that has the pipe open; false when there is none (ENXIO). */
  const tryWrite = (text: string): boolean => {
    let fd: number;
    try {
      fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENXIO") return false;
      throw e;
    }
    try {
      fs.writeSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  };
  const replaceByFile = (text: string) => {
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.held-tmp`);
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  };
  return {
    async release(text, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (!tryWrite(text)) {
        if (Date.now() > deadline) throw new Error(`no reader opened ${file} within ${timeoutMs} ms`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      released = true;
      replaceByFile(text);
    },
    abandon() {
      if (released) return;
      try {
        if (fs.lstatSync(file).isFIFO()) tryWrite("");
      } catch {
        // gone already, or no reader
      }
    },
  };
}
