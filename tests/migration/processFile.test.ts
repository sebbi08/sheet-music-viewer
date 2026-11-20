import { describe, expect, test, vi } from "vitest";
import type { MarkupPayload, MigrateSidecarInput, MigrateSidecarResult, WriteBlock } from "../../src/models/markup";
import type { SidecarContent } from "../../src/pdfMarkup/legacySidecar";
import { processFile, type ProcessFileDeps } from "../../src/migration/processFile";
import type { MigrationCandidate } from "../../src/migration/types";

const candidate: MigrationCandidate = { pdfPath: "/s/a.pdf", sidecarPath: "/s/.a.data", relativePath: "a.pdf" };
const rect = { type: "rect", left: 100, top: 200, width: 50, height: 40, angle: 0, scaleX: 1, scaleY: 1 };
const legacyEntry = (objects: unknown[], page: number) => ({
  page,
  data: { version: "7", objects },
  drawWidth: 300,
  drawHeight: 400,
});
const legacy = (objects: unknown[] = [rect], page = 1) => JSON.stringify([legacyEntry(objects, page)]);
const payload: MarkupPayload = { version: 1, width: 600, height: 800, fabric: { objects: [rect] } };

function setup(sidecar: SidecarContent, writeBlock: WriteBlock | null = null, result: MigrateSidecarResult = { status: "migrated" }) {
  const destroy = vi.fn(async () => {});
  const deps = {
    readSource: vi.fn(async (_c: MigrationCandidate) => ({ sidecar, writeBlock })),
    loadPdf: vi.fn(async (_path: string) => ({
      numPages: 3,
      viewportOf: async () => ({ width: 600, height: 800, rotation: 0 }),
      destroy,
    })),
    renderPng: vi.fn(async (_payload: MarkupPayload) => "PNG"),
    migrate: vi.fn(async (_input: MigrateSidecarInput): Promise<MigrateSidecarResult> => result),
    discardEmptySidecar: vi.fn(async (_path: string) => ({ deleted: true })),
  } satisfies ProcessFileDeps;
  return { deps, destroy };
}

describe("processFile", () => {
  test("sidecar gone -> gone, the PDF is never loaded", async () => {
    const { deps } = setup({ kind: "gone" });
    expect(await processFile(candidate, deps, "check")).toEqual({ kind: "gone" });
    expect(await processFile(candidate, deps, "write")).toEqual({ kind: "gone" });
    expect(deps.loadPdf).not.toHaveBeenCalled();
    expect(deps.migrate).not.toHaveBeenCalled();
    expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("sidecar unreadable -> failed dataUnreadable with the message", async () => {
    const { deps } = setup({ kind: "unreadable", message: "EACCES: permission denied" });
    expect(await processFile(candidate, deps, "check")).toEqual({
      kind: "failed",
      reason: "dataUnreadable",
      message: "EACCES: permission denied",
    });
    expect(deps.loadPdf).not.toHaveBeenCalled();
    expect(deps.migrate).not.toHaveBeenCalled();
  });

  test("empty sidecar: check -> ok deleteEmpty without any write; write -> discardEmptySidecar is called", async () => {
    const check = setup({ kind: "empty" });
    expect(await processFile(candidate, check.deps, "check")).toEqual({ kind: "ok", plan: "deleteEmpty" });
    expect(check.deps.discardEmptySidecar).not.toHaveBeenCalled();
    expect(check.deps.migrate).not.toHaveBeenCalled();
    expect(check.deps.loadPdf).not.toHaveBeenCalled();

    const write = setup({ kind: "empty" });
    expect(await processFile(candidate, write.deps, "write")).toEqual({ kind: "ok", plan: "deleteEmpty" });
    expect(write.deps.discardEmptySidecar).toHaveBeenCalledWith(candidate.pdfPath);
    expect(write.deps.migrate).not.toHaveBeenCalled();
  });

  test("empty sidecar next to a read-only PDF or folder -> failed readOnly in both modes, nothing discarded", async () => {
    for (const mode of ["check", "write"] as const) {
      const { deps } = setup({ kind: "empty" }, { reason: "readOnly" });
      expect(await processFile(candidate, deps, mode)).toEqual({ kind: "failed", reason: "readOnly" });
      expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
      expect(deps.loadPdf).not.toHaveBeenCalled();
      expect(deps.migrate).not.toHaveBeenCalled();
    }
  });

  test.each(["encrypted", "unparseable", "structure"] as const)(
    "empty sidecar with write block %s stays ok deleteEmpty",
    async (reason) => {
      const check = setup({ kind: "empty" }, { reason, message: "detail" });
      expect(await processFile(candidate, check.deps, "check")).toEqual({ kind: "ok", plan: "deleteEmpty" });
      const write = setup({ kind: "empty" }, { reason, message: "detail" });
      expect(await processFile(candidate, write.deps, "write")).toEqual({ kind: "ok", plan: "deleteEmpty" });
      expect(write.deps.discardEmptySidecar).toHaveBeenCalledWith(candidate.pdfPath);
    },
  );

  test("empty sidecar that cannot be discarded in write mode -> failed other", async () => {
    const { deps } = setup({ kind: "empty" });
    deps.discardEmptySidecar.mockResolvedValue({ deleted: false });
    const outcome = await processFile(candidate, deps, "write");
    expect(outcome).toMatchObject({ kind: "failed", reason: "other" });
    expect((outcome as { message?: string }).message).toContain(".a.data");
  });

  test.each(["encrypted", "readOnly", "unparseable", "structure"] as const)(
    "write block %s -> failed with that reason; pdf.js is not started",
    async (reason) => {
      const { deps } = setup({ kind: "legacy", text: legacy() }, { reason, message: "detail" });
      expect(await processFile(candidate, deps, "check")).toEqual({ kind: "failed", reason, message: "detail" });
      expect(deps.loadPdf).not.toHaveBeenCalled();
      expect(deps.migrate).not.toHaveBeenCalled();
    },
  );

  test("pdf.js cannot open the PDF -> failed unparseable with its message", async () => {
    const { deps } = setup({ kind: "legacy", text: legacy() });
    deps.loadPdf.mockRejectedValue(new Error("Invalid PDF structure"));
    expect(await processFile(candidate, deps, "check")).toEqual({
      kind: "failed",
      reason: "unparseable",
      message: "Invalid PDF structure",
    });
    expect(deps.migrate).not.toHaveBeenCalled();
  });

  test("legacy data partly unconvertible -> failed dataDamaged, nothing is saved", async () => {
    const text = JSON.stringify([legacyEntry([rect], 1), { page: "x", data: { objects: [rect] } }]);
    const { deps } = setup({ kind: "legacy", text });
    expect(await processFile(candidate, deps, "write")).toEqual({ kind: "failed", reason: "dataDamaged" });
    expect(deps.migrate).not.toHaveBeenCalled();
    expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("legacy data with markup only on pages the PDF lacks -> failed dataDamaged", async () => {
    const { deps } = setup({ kind: "legacy", text: legacy([rect], 9) });
    expect(await processFile(candidate, deps, "write")).toEqual({ kind: "failed", reason: "dataDamaged" });
    expect(deps.migrate).not.toHaveBeenCalled();
    expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("v1 page beyond the page count -> failed dataDamaged", async () => {
    const { deps } = setup({
      kind: "v1",
      pages: [
        { page: 1, payload },
        { page: 9, payload },
      ],
    });
    expect(await processFile(candidate, deps, "write")).toEqual({ kind: "failed", reason: "dataDamaged" });
    expect(deps.migrate).not.toHaveBeenCalled();
  });

  test("a PNG that cannot be rendered -> failed renderFailed with the message", async () => {
    const { deps } = setup({ kind: "legacy", text: legacy() });
    deps.renderPng.mockRejectedValue(new Error("canvas too large"));
    expect(await processFile(candidate, deps, "check")).toEqual({
      kind: "failed",
      reason: "renderFailed",
      message: "canvas too large",
    });
    expect(deps.migrate).not.toHaveBeenCalled();
  });

  test("check mode calls migrate with dryRun true, write mode with dryRun false", async () => {
    const text = JSON.stringify([legacyEntry([rect], 1), legacyEntry([], 2)]);
    const check = setup({ kind: "legacy", text });
    await processFile(candidate, check.deps, "check");
    expect(check.deps.migrate).toHaveBeenCalledTimes(1);
    const input = check.deps.migrate.mock.calls[0][0];
    expect(input.dryRun).toBe(true);
    expect(input.path).toBe(candidate.pdfPath);
    expect(input.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(input.pages[0].pngBase64).toBe("PNG");
    expect(input.pages[1]).toEqual({ page: 2, payload: null, pngBase64: null });

    const write = setup({ kind: "v1", pages: [{ page: 2, payload }] });
    await processFile(candidate, write.deps, "write");
    const written = write.deps.migrate.mock.calls[0][0];
    expect(written.dryRun).toBe(false);
    expect(written.pages).toEqual([{ page: 2, payload, pngBase64: "PNG" }]);
    expect(write.deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("migrated -> ok migrate; alreadyMigrated -> ok deleteMigrated", async () => {
    const a = setup({ kind: "legacy", text: legacy() }, null, { status: "migrated" });
    expect(await processFile(candidate, a.deps, "write")).toEqual({ kind: "ok", plan: "migrate" });
    const b = setup({ kind: "legacy", text: legacy() }, null, { status: "alreadyMigrated" });
    expect(await processFile(candidate, b.deps, "check")).toEqual({ kind: "ok", plan: "deleteMigrated" });
  });

  test.each([
    ["conflict", "conflict"],
    ["locked", "locked"],
    ["sidecarNotDeleted", "sidecarNotDeleted"],
    ["structure", "structure"],
  ] as const)("migrate error %s -> failed %s", async (error, reason) => {
    const { deps } = setup({ kind: "legacy", text: legacy() }, null, { status: "error", reason: error, message: "why" });
    expect(await processFile(candidate, deps, "write")).toEqual({ kind: "failed", reason, message: "why" });
  });

  test("the pdf.js document is released after success and after every failure", async () => {
    const cases: [string, (deps: ReturnType<typeof setup>["deps"]) => void, SidecarContent][] = [
      ["success", () => {}, { kind: "legacy", text: legacy() }],
      ["damaged", () => {}, { kind: "legacy", text: legacy([rect], 9) }],
      ["v1 beyond", () => {}, { kind: "v1", pages: [{ page: 9, payload }] }],
      ["render", (d) => d.renderPng.mockRejectedValue(new Error("x")), { kind: "legacy", text: legacy() }],
      ["migrate error", (d) => d.migrate.mockResolvedValue({ status: "error", reason: "locked" }), { kind: "legacy", text: legacy() }],
      ["migrate throws", (d) => d.migrate.mockRejectedValue(new Error("ipc")), { kind: "legacy", text: legacy() }],
    ];
    for (const [name, arrange, sidecar] of cases) {
      const { deps, destroy } = setup(sidecar);
      arrange(deps);
      await processFile(candidate, deps, "write");
      expect(deps.loadPdf, name).toHaveBeenCalledTimes(1);
      expect(destroy, name).toHaveBeenCalledTimes(1);
    }
  });

  test("a throwing dependency -> failed other with the message, never a rejection", async () => {
    const read = setup({ kind: "legacy", text: legacy() });
    read.deps.readSource.mockRejectedValue(new Error("ipc down"));
    expect(await processFile(candidate, read.deps, "check")).toEqual({ kind: "failed", reason: "other", message: "ipc down" });

    const migrate = setup({ kind: "legacy", text: legacy() });
    migrate.deps.migrate.mockRejectedValue(new Error("disk full"));
    expect(await processFile(candidate, migrate.deps, "write")).toEqual({ kind: "failed", reason: "other", message: "disk full" });

    const discard = setup({ kind: "empty" });
    discard.deps.discardEmptySidecar.mockRejectedValue("EPERM");
    expect(await processFile(candidate, discard.deps, "write")).toEqual({ kind: "failed", reason: "other", message: "EPERM" });

    const release = setup({ kind: "legacy", text: legacy() });
    release.destroy.mockRejectedValue(new Error("worker gone"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await processFile(candidate, release.deps, "write")).toEqual({ kind: "ok", plan: "migrate" });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
