import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MarkupSaveQueue, type SaveEvent } from "../../src/markup/saveQueue";
import type { MarkupPayload, SaveMarkupInput, SaveMarkupResult } from "../../src/models/markup";

const payload = (n: number): MarkupPayload => ({ version: 1, width: 595, height: 842, fabric: { objects: [{ left: n }] } });
const entry = (n: number) => ({ rect: null, payload: payload(n) });
const A = "/noten/a.pdf";
const B = "/noten/b.pdf";

/** A controllable `save`: every call waits until the test resolves it (or answers immediately with `auto`). */
function fakeBackend() {
  const calls: SaveMarkupInput[] = [];
  const waiting: ((r: SaveMarkupResult) => void)[] = [];
  let auto: SaveMarkupResult | null = { status: "pdf" };
  return {
    calls,
    save: vi.fn((input: SaveMarkupInput) => {
      calls.push(structuredClone(input));
      if (auto) return Promise.resolve(auto);
      return new Promise<SaveMarkupResult>((resolve) => waiting.push(resolve));
    }),
    answerWith(result: SaveMarkupResult | null) {
      auto = result;
    },
    resolveNext(result: SaveMarkupResult) {
      const next = waiting.shift();
      if (!next) throw new Error("no save is waiting");
      next(result);
    },
    get waitingCount() {
      return waiting.length;
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let backend: ReturnType<typeof fakeBackend>;
let events: SaveEvent[];
let queue: MarkupSaveQueue;

beforeEach(() => {
  vi.useFakeTimers();
  backend = fakeBackend();
  events = [];
  queue = new MarkupSaveQueue({
    save: backend.save,
    renderPng: async (p) => `png-${(p.fabric.objects[0] as { left: number }).left}`,
    onEvent: (e) => events.push(e),
    retryIntervalMs: 30_000,
  });
});
afterEach(() => {
  queue.dispose();
  vi.useRealTimers();
});

describe("MarkupSaveQueue", () => {
  test("a change is saved with its PNG and is no longer pending afterwards", async () => {
    queue.setPage(A, 2, entry(2));
    expect(queue.hasPending(A)).toBe(true);
    await queue.flush();
    expect(backend.calls).toEqual([
      { path: A, pages: [{ page: 2, payload: payload(2), pngBase64: "png-2" }] },
    ]);
    expect(queue.hasPending()).toBe(false);
    expect(events).toEqual([{ type: "saved", path: A, status: "pdf", afterFailure: false }]);
  });

  test("removing a page's markup is sent as payload null", async () => {
    queue.setPage(A, 1, null);
    await queue.flush();
    expect(backend.calls[0].pages).toEqual([{ page: 1, payload: null, pngBase64: null }]);
  });

  test("a failed save keeps the changes pending (outside any component) and reports the failure once", async () => {
    backend.answerWith({ status: "error", message: "EBUSY" });
    queue.setPage(A, 1, entry(1));
    expect(await queue.flush()).toBe(false);
    expect(queue.pendingPages(A)).toEqual(new Map([[1, entry(1)]]));
    queue.setPage(A, 2, entry(2)); // a new save: retried with all pending pages
    await queue.flush();
    expect(backend.calls.at(-1)?.pages.map((p) => p.page)).toEqual([1, 2]);
    // flush waited for the save in flight instead of starting another one.
    expect(backend.calls).toHaveLength(2);
    expect(events.filter((e) => e.type === "failed")).toEqual([
      { type: "failed", path: A, message: "EBUSY", firstFailure: true },
      { type: "failed", path: A, message: "EBUSY", firstFailure: false },
    ]);
  });

  test("a throwing save or PNG rendering counts as a failure, never rejects", async () => {
    backend.save.mockRejectedValueOnce(new Error("IPC gone"));
    queue.setPage(A, 1, entry(1));
    await expect(queue.flush()).resolves.toBe(false);
    expect(events[0]).toMatchObject({ type: "failed", message: "IPC gone" });

    const q2 = new MarkupSaveQueue({ save: backend.save, renderPng: () => Promise.reject(new Error("no font")) });
    q2.setPage(B, 1, entry(1));
    await expect(q2.flush()).resolves.toBe(false);
    expect(q2.hasPending(B)).toBe(true);
    q2.dispose();
  });

  test("pending changes are retried every 30 s while saving fails, then the timer stops", async () => {
    backend.answerWith({ status: "error", message: "locked" });
    queue.setPage(A, 1, entry(1));
    await settle();
    expect(backend.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.calls).toHaveLength(2);
    backend.answerWith({ status: "pdf" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.calls).toHaveLength(3);
    expect(queue.hasPending()).toBe(false);
    expect(events.at(-1)).toEqual({ type: "saved", path: A, status: "pdf", afterFailure: true });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(backend.calls).toHaveLength(3); // nothing pending: no more retries
  });

  test("a new save of another sheet also retries failed sheets", async () => {
    backend.answerWith({ status: "error", message: "locked" });
    queue.setPage(A, 1, entry(1));
    await settle();
    backend.answerWith({ status: "pdf" });
    queue.setPage(B, 3, entry(3));
    await queue.flush();
    expect(backend.calls.map((c) => c.path).sort()).toEqual([A, A, B]);
    expect(queue.hasPending()).toBe(false);
  });

  test("a page edited again while its save is in flight stays pending and is sent again", async () => {
    backend.answerWith(null);
    queue.setPage(A, 1, entry(1));
    await settle();
    queue.setPage(A, 1, entry(11));
    queue.setPage(A, 2, entry(2));
    backend.resolveNext({ status: "pdf" });
    await settle();
    expect(queue.pendingPages(A)).toEqual(new Map([[1, entry(11)], [2, entry(2)]]));
    backend.resolveNext({ status: "pdf" });
    await settle();
    expect(backend.calls.map((c) => c.pages.map((p) => p.pngBase64))).toEqual([["png-1"], ["png-11", "png-2"]]);
    expect(queue.hasPending()).toBe(false);
  });

  test("saves of one sheet never overlap", async () => {
    backend.answerWith(null);
    queue.setPage(A, 1, entry(1));
    await settle();
    queue.setPage(A, 2, entry(2));
    await settle();
    expect(backend.waitingCount).toBe(1);
    backend.resolveNext({ status: "pdf" });
    await settle();
    expect(backend.waitingCount).toBe(1); // page 2, sent after the first save finished
    backend.resolveNext({ status: "pdf" });
    await settle();
    expect(queue.hasPending()).toBe(false);
  });

  test("flush waits for a save in flight and reports whether anything is left", async () => {
    backend.answerWith(null);
    queue.setPage(A, 1, entry(1));
    await settle();
    let done: boolean | undefined;
    void queue.flush().then((ok) => (done = ok));
    await settle();
    expect(done).toBeUndefined();
    backend.resolveNext({ status: "pdf" });
    await settle();
    expect(done).toBe(true);
  });

  test("flush retries pending sheets once", async () => {
    backend.answerWith({ status: "error", message: "locked" });
    queue.setPage(A, 1, entry(1));
    await settle();
    backend.answerWith({ status: "pdf" });
    expect(await queue.flush()).toBe(true);
    expect(backend.calls).toHaveLength(2);
  });

  test("setPages sends several pages in one save", async () => {
    queue.setPages(A, [
      [3, entry(3)],
      [1, null],
    ]);
    await queue.flush();
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].pages.map((p) => p.page)).toEqual([1, 3]);
  });

  test("discard drops pending changes (all or one sheet)", async () => {
    backend.answerWith({ status: "error", message: "locked" });
    queue.setPage(A, 1, entry(1));
    queue.setPage(B, 1, entry(1));
    await queue.flush();
    queue.discard(A);
    expect(queue.pendingPaths()).toEqual([B]);
    queue.discard();
    expect(queue.hasPending()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.calls).toHaveLength(2);
  });

  test("paths are keyed with keyOf (e.g. case-insensitive on Windows), the first spelling is used for saving", async () => {
    const q = new MarkupSaveQueue({ save: backend.save, renderPng: async () => "png", keyOf: (p) => p.toLowerCase() });
    backend.answerWith({ status: "error", message: "locked" });
    q.setPage("C:\\Noten\\A.pdf", 1, entry(1));
    await q.flush();
    expect(q.pendingPages("c:\\noten\\a.PDF")).toEqual(new Map([[1, entry(1)]]));
    backend.answerWith({ status: "pdf" });
    q.setPage("c:\\noten\\a.PDF", 2, entry(2));
    await q.flush();
    expect(backend.calls.at(-1)).toMatchObject({ path: "C:\\Noten\\A.pdf" });
    expect(backend.calls.at(-1)?.pages.map((p) => p.page)).toEqual([1, 2]);
    q.dispose();
  });

  test("pendingPages returns a copy", () => {
    backend.answerWith(null);
    queue.setPage(A, 1, entry(1));
    queue.pendingPages(A).clear();
    expect(queue.hasPending(A)).toBe(true);
  });
});
