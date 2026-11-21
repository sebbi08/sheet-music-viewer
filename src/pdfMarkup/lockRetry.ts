/**
 * Retries for file operations on a file another program holds open for a moment (main). Its own module so
 * that both the markup file layer and the folder probe can use it without an import cycle. Electron-free.
 */

const errorCode = (e: unknown) => (e instanceof Error && "code" in e ? e.code : undefined);

/**
 * Windows reports a file that another program (Acrobat, a virus scanner, a sync client) holds open as
 * EBUSY, EPERM or EACCES; usually only for a moment.
 */
export const isLockedError = (e: unknown) => ["EBUSY", "EPERM", "EACCES"].includes(String(errorCode(e)));

/** Waits between the attempts of a locked file operation: about 3 s in total. */
let lockRetryDelaysMs: readonly number[] = [50, 100, 200, 400, 750, 1500];

/** For tests: sets the waits between attempts (an empty list = no retry) and returns the previous ones. */
export function setLockRetryDelays(delaysMs: readonly number[]): readonly number[] {
  const previous = lockRetryDelaysMs;
  lockRetryDelaysMs = delaysMs;
  return previous;
}

/** Runs `operation`, repeating it while it fails because the file is locked (see `isLockedError`). */
export async function retryWhileLocked<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (e) {
      const delay = lockRetryDelaysMs[attempt];
      if (delay === undefined || !isLockedError(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
