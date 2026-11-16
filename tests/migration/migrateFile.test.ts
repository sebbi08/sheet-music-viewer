import { describe, expect, test, vi } from "vitest";
import type { LoadMarkupResult, MarkupPayload, SaveMarkupInput, SaveMarkupResult } from "../../src/models/markup";
import { migrateFile, type MigrateFileDeps } from "../../src/migration/migrateFile";
import { PERMANENT_REASONS, type FailureReason, type MigrationCandidate } from "../../src/migration/types";

const candidate: MigrationCandidate = { pdfPath: "/s/a.pdf", sidecarPath: "/s/.a.pdf.data", relativePath: "a.pdf" };
const rect = { type: "rect", left: 100, top: 200, width: 50, height: 40, angle: 0, scaleX: 1, scaleY: 1 };
const legacyEntry = (objects: unknown[], page: number) => ({
  page,
  data: { version: "7", objects },
  drawWidth: 300,
  drawHeight: 400,
});
const legacy = (objects: unknown[] = [rect], page = 1) => JSON.stringify([legacyEntry(objects, page)]);
const payload: MarkupPayload = { version: 1, width: 600, height: 800, fabric: { objects: [rect] } };

const markup = (over: Partial<LoadMarkupResult>): LoadMarkupResult => ({
  source: "none",
  pages: [],
  legacyOverlayData: null,
  pdfIssue: null,
  ...over,
});

function setup(loaded: Partial<LoadMarkupResult>, saveResult: SaveMarkupResult = { status: "pdf" }) {
  const destroy = vi.fn(async () => {});
  const saved: SaveMarkupInput[] = [];
  const deps = {
    loadMarkup: vi.fn(async () => markup(loaded)),
    loadPdf: vi.fn(async () => ({
      numPages: 3,
      viewportOf: async () => ({ width: 600, height: 800, rotation: 0 }),
      destroy,
    })),
    save: vi.fn(async (input: SaveMarkupInput) => {
      saved.push(input);
      return saveResult;
    }),
    renderPng: vi.fn(async (_payload: MarkupPayload) => "PNG"),
    discardEmptySidecar: vi.fn(async (_path: string) => ({ deleted: true })),
  } satisfies MigrateFileDeps;
  return { deps, destroy, saved };
}

describe("migrateFile", () => {
  test("already embedded fails permanently without saving", async () => {
    const { deps } = setup({ source: "pdf" });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "alreadyEmbedded" });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.loadPdf).not.toHaveBeenCalled();
  });

  test("pdf load failure with pdfIssue is notWritable, without is other", async () => {
    const a = setup({ pdfIssue: "encrypted", legacyOverlayData: legacy() });
    a.deps.loadPdf.mockRejectedValue(new Error("boom"));
    expect(await migrateFile(candidate, a.deps)).toEqual({ kind: "failed", reason: "notWritable" });
    const b = setup({ legacyOverlayData: legacy() });
    b.deps.loadPdf.mockRejectedValue(new Error("boom"));
    expect(await migrateFile(candidate, b.deps)).toEqual({ kind: "failed", reason: "other", message: "boom" });
  });

  test("corrupt legacy data saves nothing", async () => {
    const { deps } = setup({ legacyOverlayData: "{not json" });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "corruptData" });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("whitespace sidecar is discarded without touching the pdf", async () => {
    const { deps } = setup({ legacyOverlayData: "  \n" });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "migrated" });
    expect(deps.discardEmptySidecar).toHaveBeenCalledWith(candidate.pdfPath);
    expect(deps.save).not.toHaveBeenCalled();
  });

  test("legacy data without markup is discarded; a refused discard is corruptData", async () => {
    const { deps } = setup({ legacyOverlayData: legacy([]) });
    deps.discardEmptySidecar.mockResolvedValue({ deleted: false });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "corruptData" });
    expect(deps.save).not.toHaveBeenCalled();
  });

  test("a vanished sidecar (no legacy text, nothing deleted) is transient, not corruptData", async () => {
    const { deps } = setup({ source: "none", legacyOverlayData: null });
    deps.discardEmptySidecar.mockResolvedValue({ deleted: false });
    const outcome = await migrateFile(candidate, deps);
    expect(outcome).toEqual({ kind: "failed", reason: "other", message: "Markierungsdatei nicht gefunden" });
    expect(PERMANENT_REASONS.has((outcome as { reason: FailureReason }).reason)).toBe(false);
  });

  test("a v1 sidecar with pages beyond the pdf is permanent corruptData and saves nothing", async () => {
    const { deps } = setup({
      source: "sidecar",
      pages: [
        { page: 1, rect: null, payload },
        { page: 9, rect: null, payload },
      ],
    });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "corruptData" });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("a rejecting discard becomes other and never throws", async () => {
    const { deps, destroy } = setup({ legacyOverlayData: "" });
    deps.discardEmptySidecar.mockRejectedValue(new Error("locked rm"));
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "other", message: "locked rm" });
    expect(destroy).toHaveBeenCalled();
  });

  test("saves all pages with deleteLegacySidecar", async () => {
    const { deps, saved } = setup({
      legacyOverlayData: JSON.stringify([legacyEntry([rect], 1), legacyEntry([], 2)]),
    });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "migrated" });
    expect(saved).toHaveLength(1);
    expect(saved[0].path).toBe(candidate.pdfPath);
    expect(saved[0].deleteLegacySidecar).toBe(true);
    expect(saved[0].pages.map((p) => p.page)).toEqual([1, 2]);
    expect(saved[0].pages[0].pngBase64).toBe("PNG");
    expect(saved[0].pages[1]).toEqual({ page: 2, payload: null, pngBase64: null });
  });

  test("v1 sidecar pages are saved", async () => {
    const { deps, saved } = setup({ source: "sidecar", pages: [{ page: 2, rect: null, payload }] });
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "migrated" });
    expect(saved[0].pages.map((p) => p.page)).toEqual([2]);
    expect(deps.discardEmptySidecar).not.toHaveBeenCalled();
  });

  test("read-only maps to notWritable", async () => {
    for (const reason of ["readOnly", "encrypted", "unparseable"] as const) {
      const { deps } = setup({ legacyOverlayData: legacy() }, { status: "sidecar", reason });
      expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "notWritable" });
    }
  });

  test("locked maps to locked", async () => {
    for (const status of ["sidecar", "error"] as const) {
      const { deps } = setup({ legacyOverlayData: legacy() }, { status, reason: "locked" });
      expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "locked" });
    }
  });

  test("other errors carry the message; a sidecar result with other is transient", async () => {
    const a = setup({ legacyOverlayData: legacy() }, { status: "error", reason: "other", message: "disk full" });
    expect(await migrateFile(candidate, a.deps)).toEqual({ kind: "failed", reason: "other", message: "disk full" });
    const b = setup({ legacyOverlayData: legacy() }, { status: "sidecar", reason: "other" });
    expect(await migrateFile(candidate, b.deps)).toMatchObject({ kind: "failed", reason: "other" });
  });

  test("destroys every loaded pdf, also on failure", async () => {
    const ok = setup({ legacyOverlayData: legacy() });
    await migrateFile(candidate, ok.deps);
    expect(ok.destroy).toHaveBeenCalledTimes(1);

    const corrupt = setup({ legacyOverlayData: "{" });
    await migrateFile(candidate, corrupt.deps);
    expect(corrupt.destroy).toHaveBeenCalledTimes(1);

    const saveThrows = setup({ legacyOverlayData: legacy() });
    saveThrows.deps.save.mockRejectedValue(new Error("x"));
    expect(await migrateFile(candidate, saveThrows.deps)).toMatchObject({ kind: "failed", reason: "other" });
    expect(saveThrows.destroy).toHaveBeenCalledTimes(1);

    const renderThrows = setup({ legacyOverlayData: legacy() });
    renderThrows.deps.renderPng.mockRejectedValue(new Error("x"));
    expect(await migrateFile(candidate, renderThrows.deps)).toMatchObject({ kind: "failed", reason: "other" });
    expect(renderThrows.destroy).toHaveBeenCalledTimes(1);
  });

  test("a vanished file (loadMarkup rejects) fails as other", async () => {
    const { deps } = setup({});
    deps.loadMarkup.mockRejectedValue(new Error("ENOENT"));
    expect(await migrateFile(candidate, deps)).toEqual({ kind: "failed", reason: "other", message: "ENOENT" });
  });
});
