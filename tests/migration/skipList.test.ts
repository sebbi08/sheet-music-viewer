import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkipList } from "../../src/migration/skipList";
import type { MigrationCandidate } from "../../src/migration/types";

let dir: string;
let cand: MigrationCandidate;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-skip-"));
  const pdfPath = path.join(dir, "a.pdf");
  const sidecarPath = path.join(dir, ".a.data");
  fs.writeFileSync(pdfPath, "pdf");
  fs.writeFileSync(sidecarPath, "data");
  cand = { pdfPath, sidecarPath, relativePath: "a.pdf" };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("SkipList", () => {
  it("skip list survives reload from disk", async () => {
    const file = path.join(dir, "skips.json");
    const list = await SkipList.load(file);
    expect(await list.isSkipped(cand)).toBe(false);
    await list.record(cand, "corruptData");
    expect(await list.isSkipped(cand)).toBe(true);
    expect(await (await SkipList.load(file)).isSkipped(cand)).toBe(true);
  });

  it("is no longer skipped after the pdf or sidecar changed", async () => {
    const list = await SkipList.load(path.join(dir, "skips.json"));
    await list.record(cand, "notWritable");
    fs.writeFileSync(cand.sidecarPath, "data changed");
    expect(await list.isSkipped(cand)).toBe(false);
    await list.record(cand, "notWritable");
    expect(await list.isSkipped(cand)).toBe(true);
    fs.writeFileSync(cand.pdfPath, "pdf changed");
    expect(await list.isSkipped(cand)).toBe(false);
  });

  it("a missing or broken skip file is an empty list", async () => {
    expect(await (await SkipList.load(path.join(dir, "none.json"))).isSkipped(cand)).toBe(false);
    const broken = path.join(dir, "broken.json");
    fs.writeFileSync(broken, "{not json");
    expect(await (await SkipList.load(broken)).isSkipped(cand)).toBe(false);
  });
});
