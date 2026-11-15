import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { UnsavedMarkupChoice } from "../../src/exitGuardMachine";
import { createCloseGuard, SAVING_ON_CLOSE_TEXT, UPDATE_ASK_FAILED_TEXT } from "../../src/markup/closeGuard";

/** A queue whose flush the test controls. */
function fakeQueue() {
  let pending = false;
  const flushes: ((saved: boolean) => void)[] = [];
  return {
    flushes,
    setPending(value: boolean) {
      pending = value;
    },
    queue: {
      flush: vi.fn(
        () =>
          new Promise<boolean>((resolve) =>
            flushes.push((saved) => {
              if (saved) pending = false;
              resolve(saved);
            }),
          ),
      ),
      hasPending: () => pending,
      pendingPaths: () => (pending ? ["/noten/Song A.pdf", "C:\\Noten\\Song B.pdf"] : []),
      discard: vi.fn(() => {
        pending = false;
      }),
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const unloadEvent = () => ({ preventDefault: vi.fn(), returnValue: undefined as unknown });

let q: ReturnType<typeof fakeQueue>;
let asks: { files: string[]; forExit: boolean; answer(c: UnsavedMarkupChoice): void; fail(e: Error): void }[];
let calls: string[];
let notices: string[];
let guard: ReturnType<typeof createCloseGuard>;

beforeEach(() => {
  vi.useFakeTimers();
  q = fakeQueue();
  asks = [];
  calls = [];
  notices = [];
  guard = createCloseGuard({
    queue: q.queue,
    captureOpenEdits: () => calls.push("capture"),
    ask: (files, forExit) =>
      new Promise<UnsavedMarkupChoice>((resolve, reject) => asks.push({ files, forExit, answer: resolve, fail: reject })),
    resume: async () => {
      calls.push("resume");
    },
    showNotice: (text) => notices.push(`show:${text}`),
    hideNotice: (text) => notices.push(`hide:${text}`),
    savingNoticeDelayMs: 500,
    log: () => calls.push("log"),
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("close guard (beforeunload)", () => {
  test("nothing pending: the unload goes through, open edits are captured first", () => {
    const event = unloadEvent();
    guard.onBeforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(calls).toEqual(["capture"]);
    expect(q.queue.flush).not.toHaveBeenCalled();
  });

  test("pending: blocked, saved, then main is told to continue", async () => {
    q.setPending(true);
    const event = unloadEvent();
    guard.onBeforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe(false);
    q.flushes[0](true);
    await settle();
    expect(calls).toEqual(["capture", "resume"]);
    expect(guard.isGuarding()).toBe(false);
  });

  test("saving fails: asks main (for an exit) with the file names; retry saves again", async () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    q.flushes[0](false);
    await settle();
    expect(asks.map((a) => [a.files, a.forExit])).toEqual([[["Song A.pdf", "Song B.pdf"], true]]);
    asks[0].answer("retry");
    await settle();
    q.flushes[1](true);
    await settle();
    expect(calls).toEqual(["capture", "resume"]);
  });

  test("discard: drops the changes; main closes the window itself (no resume)", async () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    q.flushes[0](false);
    await settle();
    asks[0].answer("discard");
    await settle();
    expect(q.queue.discard).toHaveBeenCalled();
    expect(calls).toEqual(["capture"]);
    expect(guard.isGuarding()).toBe(false);
  });

  test("cancel: stays; the next close starts over", async () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    q.flushes[0](false);
    await settle();
    asks[0].answer("cancel");
    await settle();
    expect(guard.isGuarding()).toBe(false);
    guard.onBeforeUnload(unloadEvent());
    expect(q.queue.flush).toHaveBeenCalledTimes(2);
  });

  test("a failed ask IPC is not a silent cancel: nothing is reported, main's timeout takes over", async () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    q.flushes[0](false);
    await settle();
    asks[0].fail(new Error("IPC broken"));
    await settle();
    expect(calls).toEqual(["capture", "log"]);
    expect(q.queue.discard).not.toHaveBeenCalled();
    expect(guard.isGuarding()).toBe(false);
  });

  test("a second close while saving is blocked too (main shows its dialog), without a second save", () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    const second = unloadEvent();
    guard.onBeforeUnload(second);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(q.queue.flush).toHaveBeenCalledTimes(1);
  });

  test("a slow save shows 'Markierungen werden gespeichert …' until it is done", async () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    vi.advanceTimersByTime(499);
    expect(notices).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(notices).toEqual([`show:${SAVING_ON_CLOSE_TEXT}`]);
    q.flushes[0](true);
    await settle();
    expect(notices).toEqual([`show:${SAVING_ON_CLOSE_TEXT}`, `hide:${SAVING_ON_CLOSE_TEXT}`]);
  });

  test("a fast save shows no notice", async () => {
    q.setPending(true);
    guard.onBeforeUnload(unloadEvent());
    q.flushes[0](true);
    await settle();
    vi.advanceTimersByTime(5000);
    expect(notices.filter((n) => n.startsWith("show:"))).toEqual([]);
  });
});

describe("prepareToClose (before the update restart)", () => {
  test("saved: may restart", async () => {
    q.setPending(true);
    const result = guard.prepareToClose();
    q.flushes[0](true);
    expect(await result).toBe(true);
    expect(calls).toEqual(["capture"]);
  });

  test("not saved: asks (not for an exit); discard -> restart, cancel -> no restart", async () => {
    q.setPending(true);
    const discarded = guard.prepareToClose();
    q.flushes[0](false);
    await settle();
    expect(asks[0].forExit).toBe(false);
    asks[0].answer("discard");
    expect(await discarded).toBe(true);
    expect(q.queue.discard).toHaveBeenCalled();

    q.setPending(true);
    const cancelled = guard.prepareToClose();
    q.flushes[1](false);
    await settle();
    asks[1].answer("cancel");
    expect(await cancelled).toBe(false);
  });

  test("a failed ask IPC: no restart, and the user is told so", async () => {
    q.setPending(true);
    const result = guard.prepareToClose();
    q.flushes[0](false);
    await settle();
    asks[0].fail(new Error("IPC broken"));
    expect(await result).toBe(false);
    expect(notices).toEqual([`show:${UPDATE_ASK_FAILED_TEXT}`]);
  });
});
