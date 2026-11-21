import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getSidecarPath, readSidecarContent } from "../../src/pdfMarkup/legacySidecar";
import { payload } from "./fixtures";

/** chmod-based tests do not work as root (root ignores permission bits). */
const isRoot = process.getuid?.() === 0;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "smv-legacy-sidecar-"));
});
afterEach(() => {
  for (const f of fs.readdirSync(dir)) {
    try {
      fs.chmodSync(path.join(dir, f), 0o644);
    } catch {
      // ignore
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getSidecarPath (exact port of getOverlayDataFilePathFromSheetPath, v1.15.1)", () => {
  test.each([
    ["/x/Song.pdf", "/x/.Song.data"],
    ["/x/Song.PDF", "/x/.Song.data"],
    ["/x/Mo Money$$.pdf", "/x/.Mo Money$.data"], // "$$" collapses in the replacement
    ["/x/a$&b.pdf", "/x/.aa$&b.pdfb.data"], // "$&" inserts the match
    ["/x/Song.pdf-alt/Song.pdf", "/x/.Song.data-alt/Song.pdf"], // first occurrence in the whole path
  ])("%s -> %s", (pdf, expected) => expect(getSidecarPath(pdf)).toBe(expected));
});

describe("readSidecarContent", () => {
  const pdf = () => path.join(dir, "a.pdf");
  const sidecar = () => path.join(dir, ".a.data");

  test("no file -> gone", async () => {
    expect(await readSidecarContent(pdf())).toEqual({ kind: "gone" });
  });

  test.each(["", "  \n", "[]", '[{"page":1,"data":{"objects":[]}}]', '{"version":1,"pages":[]}'])(
    "%j -> empty",
    async (text) => {
      fs.writeFileSync(sidecar(), text);
      expect(await readSidecarContent(pdf())).toEqual({ kind: "empty" });
    },
  );

  test("legacy data -> legacy with the raw text", async () => {
    const text = '[{"page":1,"data":{"objects":[{"type":"path"}]}}]';
    fs.writeFileSync(sidecar(), text);
    expect(await readSidecarContent(pdf())).toEqual({ kind: "legacy", text });
  });

  test("text that is not JSON -> legacy (never empty)", async () => {
    fs.writeFileSync(sidecar(), "not json {");
    expect(await readSidecarContent(pdf())).toEqual({ kind: "legacy", text: "not json {" });
  });

  test("v1 file -> v1 with its pages", async () => {
    fs.writeFileSync(sidecar(), JSON.stringify({ version: 1, pages: [{ page: 2, payload: payload(2) }] }));
    expect(await readSidecarContent(pdf())).toEqual({ kind: "v1", pages: [{ page: 2, payload: payload(2) }] });
  });

  test.skipIf(isRoot)("chmod 000 -> unreadable with the error message", async () => {
    fs.writeFileSync(sidecar(), "[]");
    fs.chmodSync(sidecar(), 0);
    const result = await readSidecarContent(pdf());
    expect(result.kind).toBe("unreadable");
    expect(result.kind === "unreadable" && result.message).toContain("EACCES");
  });

  test("a directory at the sidecar path -> unreadable", async () => {
    fs.mkdirSync(sidecar());
    const result = await readSidecarContent(pdf());
    expect(result.kind).toBe("unreadable");
    expect(result.kind === "unreadable" && result.message).toContain("EISDIR");
  });
});
