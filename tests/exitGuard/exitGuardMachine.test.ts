import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  EXIT_GUARD_TIMEOUT_MS,
  ExitGuard,
  type DialogReason,
  type ExitKind,
  type UnsavedMarkupChoice,
} from "../../src/exitGuardMachine";

const TIMEOUT = 1000;

interface ShownDialog {
  files: string[];
  reason: DialogReason;
  signal: AbortSignal;
  answer(choice: UnsavedMarkupChoice): void;
}

/** Fake Electron side: dialogs wait until the test answers them; an aborted dialog answers "cancel". */
function fakeEffects() {
  const dialogs: ShownDialog[] = [];
  const actions: string[] = [];
  const logged: string[] = [];
  let failDialog = false;
  return {
    dialogs,
    actions,
    logged,
    failNextDialogs() {
      failDialog = true;
    },
    effects: {
      showDialog({ files, reason, signal }: { files: string[]; reason: DialogReason; signal: AbortSignal }) {
        if (failDialog) return Promise.reject(new Error("no dialog possible"));
        return new Promise<UnsavedMarkupChoice>((resolve) => {
          dialogs.push({ files, reason, signal, answer: resolve });
          signal.addEventListener("abort", () => resolve("cancel"));
        });
      },
      proceed: (kind: ExitKind) => actions.push(`proceed:${kind}`),
      force: (kind: ExitKind) => actions.push(`force:${kind}`),
      log: (message: string) => logged.push(message),
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let fake: ReturnType<typeof fakeEffects>;
let guard: ExitGuard;

beforeEach(() => {
  vi.useFakeTimers();
  fake = fakeEffects();
  guard = new ExitGuard(fake.effects, { timeoutMs: TIMEOUT });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A window close the renderer blocked because markup is unsaved. */
function blockedClose() {
  guard.exitRequested("close");
  guard.unloadPrevented();
}

describe("ExitGuard: main-side timeout", () => {
  test("the default timeout is 10 s", () => {
    expect(EXIT_GUARD_TIMEOUT_MS).toBe(10_000);
    const g = new ExitGuard(fake.effects);
    g.exitRequested("close");
    g.unloadPrevented();
    vi.advanceTimersByTime(9_999);
    expect(fake.dialogs).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fake.dialogs).toHaveLength(1);
  });

  test("renderer silent after a blocked close: main shows the dialog; discard destroys the window", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT - 1);
    expect(fake.dialogs).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fake.dialogs.map((d) => d.reason)).toEqual(["stalled"]);
    fake.dialogs[0].answer("discard");
    await settle();
    expect(fake.actions).toEqual(["force:close"]);
    expect(guard.pendingExit).toBeNull();
  });

  test("the renderer saved in time: the exit continues, no dialog later", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT / 2);
    guard.resume();
    expect(fake.actions).toEqual(["proceed:close"]);
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(0);
  });

  test("a hung renderer that never even blocks: the close request alone arms the timeout", async () => {
    guard.exitRequested("close");
    vi.advanceTimersByTime(TIMEOUT / 2);
    guard.exitRequested("close"); // clicking again must not push the dialog further out
    vi.advanceTimersByTime(TIMEOUT / 2);
    expect(fake.dialogs.map((d) => d.reason)).toEqual(["stalled"]);
    fake.dialogs[0].answer("discard");
    await settle();
    expect(fake.actions).toEqual(["force:close"]);
  });

  test("a close that goes through (window closed) leaves no timer behind", () => {
    guard.exitRequested("close");
    guard.windowClosed();
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(0);
  });

  test("main dialog 'retry' requests the exit again and waits once more for the renderer", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT);
    fake.dialogs[0].answer("retry");
    await settle();
    expect(fake.actions).toEqual(["proceed:close"]);
    // The renderer blocks the repeated close (still saving): that is a fresh wait, not a second click.
    guard.exitRequested("close");
    guard.unloadPrevented();
    expect(fake.dialogs).toHaveLength(1);
    guard.resume();
    expect(fake.actions).toEqual(["proceed:close", "proceed:close"]);
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(1);
  });

  test("main dialog 'retry' with a renderer that stays silent: the dialog comes back after the timeout", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT);
    fake.dialogs[0].answer("retry");
    await settle();
    vi.advanceTimersByTime(TIMEOUT);
    expect(fake.dialogs).toHaveLength(2);
  });

  test("main dialog 'cancel' keeps the window; late renderer reports change nothing", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT);
    fake.dialogs[0].answer("cancel");
    await settle();
    expect(guard.pendingExit).toBeNull();
    guard.resume();
    expect(await guard.ask(["a.pdf"], true)).toBe("cancel");
    expect(fake.dialogs).toHaveLength(1);
    expect(fake.actions).toEqual([]);
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(1);
  });
});

describe("ExitGuard: the renderer asks", () => {
  test("discard is carried out by main itself (no resume needed)", async () => {
    blockedClose();
    const answer = guard.ask(["a.pdf", "b.pdf"], true);
    expect(fake.dialogs.map((d) => [d.reason, d.files])).toEqual([["failed", ["a.pdf", "b.pdf"]]]);
    fake.dialogs[0].answer("discard");
    expect(await answer).toBe("discard");
    expect(fake.actions).toEqual(["force:close"]);
  });

  test("no timeout while the renderer's dialog is open", async () => {
    blockedClose();
    void guard.ask([], true);
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(1);
  });

  test("cancel: the exit is forgotten", async () => {
    blockedClose();
    const answer = guard.ask([], true);
    fake.dialogs[0].answer("cancel");
    expect(await answer).toBe("cancel");
    expect(guard.pendingExit).toBeNull();
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(1);
    expect(fake.actions).toEqual([]);
  });

  test("retry: the renderer saves again; if it then goes silent, main asks after the timeout", async () => {
    blockedClose();
    const answer = guard.ask([], true);
    fake.dialogs[0].answer("retry");
    expect(await answer).toBe("retry");
    expect(fake.actions).toEqual([]);
    vi.advanceTimersByTime(TIMEOUT);
    expect(fake.dialogs.map((d) => d.reason)).toEqual(["failed", "stalled"]);
  });

  test("a failed ask IPC (main never hears from the renderer) ends in main's own dialog", () => {
    blockedClose();
    // The renderer's askUnsavedMarkup call failed on its side: nothing arrives here.
    vi.advanceTimersByTime(TIMEOUT);
    expect(fake.dialogs.map((d) => d.reason)).toEqual(["stalled"]);
  });

  test("a dialog that cannot be shown counts as cancel and is logged", async () => {
    blockedClose();
    fake.failNextDialogs();
    expect(await guard.ask([], true)).toBe("cancel");
    expect(fake.logged).toEqual(["Could not show the unsaved markup dialog"]);
    expect(fake.actions).toEqual([]);
  });

  test("asking before the update restart (nothing interrupted): the renderer gets the answer, main does nothing", async () => {
    const answer = guard.ask(["a.pdf"], false);
    fake.dialogs[0].answer("discard");
    expect(await answer).toBe("discard");
    expect(fake.actions).toEqual([]);
  });
});

describe("ExitGuard: repeated close and one dialog at a time", () => {
  test("a second close click while the renderer is still saving shows the dialog immediately", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT / 10);
    blockedClose();
    expect(fake.dialogs.map((d) => d.reason)).toEqual(["stalled"]);
    fake.dialogs[0].answer("discard");
    await settle();
    expect(fake.actions).toEqual(["force:close"]);
  });

  test("after 'cancel' in main's dialog, the next close while the renderer is still stuck asks at once", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT);
    fake.dialogs[0].answer("cancel");
    await settle();
    blockedClose();
    expect(fake.dialogs).toHaveLength(2);
  });

  test("the renderer's ask while main's dialog is open shares it (one dialog, one action)", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT);
    const answer = guard.ask(["a.pdf"], true);
    blockedClose();
    expect(fake.dialogs).toHaveLength(1);
    fake.dialogs[0].answer("discard");
    expect(await answer).toBe("discard");
    expect(fake.actions).toEqual(["force:close"]);
  });

  test("the renderer saved while main's dialog is open: the dialog is closed and the exit continues", async () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT);
    guard.resume();
    expect(fake.dialogs[0].signal.aborted).toBe(true);
    await settle();
    expect(fake.actions).toEqual(["proceed:close"]);
    expect(guard.dialogOpen).toBe(false);
  });
});

describe("ExitGuard: quit, update restart, reload", () => {
  test("quit: resume quits; discard destroys and quits", async () => {
    guard.exitRequested("quit");
    guard.exitRequested("close"); // quitting closes the window
    guard.unloadPrevented();
    guard.resume();
    expect(fake.actions).toEqual(["proceed:quit"]);

    guard.exitRequested("quit");
    guard.exitRequested("close");
    guard.unloadPrevented();
    vi.advanceTimersByTime(TIMEOUT);
    fake.dialogs[0].answer("discard");
    await settle();
    expect(fake.actions).toEqual(["proceed:quit", "force:quit"]);
  });

  test("update restart: the later close/quit events do not downgrade it; resume and discard continue the update", async () => {
    guard.exitRequested("update");
    guard.exitRequested("close");
    guard.exitRequested("quit");
    guard.unloadPrevented();
    expect(guard.pendingExit).toBe("update");
    guard.resume();
    expect(fake.actions).toEqual(["proceed:update"]);

    guard.exitRequested("update");
    guard.exitRequested("close");
    guard.unloadPrevented();
    const answer = guard.ask([], true);
    fake.dialogs[0].answer("discard");
    await answer;
    expect(fake.actions).toEqual(["proceed:update", "force:update"]);
  });

  test("an update restart that failed to start leaves no timer", () => {
    guard.exitRequested("update");
    guard.exitFailed("update");
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(0);
  });

  test("a blocked unload without close or quit is a reload", async () => {
    guard.unloadPrevented();
    expect(guard.pendingExit).toBe("reload");
    guard.resume();
    expect(fake.actions).toEqual(["proceed:reload"]);
    guard.unloadPrevented();
    vi.advanceTimersByTime(TIMEOUT);
    fake.dialogs[0].answer("discard");
    await settle();
    expect(fake.actions).toEqual(["proceed:reload", "force:reload"]);
  });
});

describe("ExitGuard: crashed or unresponsive renderer", () => {
  test("a renderer crash during a blocked exit lets the exit go ahead", () => {
    blockedClose();
    guard.rendererGone();
    expect(fake.actions).toEqual(["force:close"]);
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(0);
  });

  test("a renderer crash while main's dialog is open closes the dialog and goes ahead", async () => {
    guard.exitRequested("quit");
    guard.unloadPrevented();
    vi.advanceTimersByTime(TIMEOUT);
    guard.rendererGone();
    expect(fake.dialogs[0].signal.aborted).toBe(true);
    await settle();
    expect(fake.actions).toEqual(["force:quit"]);
  });

  test("a renderer crash without an exit does nothing", () => {
    guard.rendererGone();
    expect(fake.actions).toEqual([]);
  });

  test("unresponsive during an exit the renderer never answered: dialog at once", async () => {
    guard.exitRequested("close");
    guard.rendererUnresponsive();
    expect(fake.dialogs.map((d) => d.reason)).toEqual(["stalled"]);
    fake.dialogs[0].answer("discard");
    await settle();
    expect(fake.actions).toEqual(["force:close"]);
  });

  test("unresponsive after the renderer blocked the close (Electron's 5 s close heuristic) is ignored", () => {
    blockedClose();
    vi.advanceTimersByTime(TIMEOUT / 2);
    guard.rendererUnresponsive();
    expect(fake.dialogs).toHaveLength(0);
    vi.advanceTimersByTime(TIMEOUT / 2);
    expect(fake.dialogs).toHaveLength(1); // the timeout decides
  });

  test("unresponsive without an exit: no dialog, and later closes keep the normal timing", () => {
    guard.rendererUnresponsive();
    expect(fake.dialogs).toHaveLength(0);
    guard.exitRequested("close");
    expect(fake.dialogs).toHaveLength(0);
    guard.windowClosed();
    vi.advanceTimersByTime(TIMEOUT * 5);
    expect(fake.dialogs).toHaveLength(0);
  });
});
