import { describe, expect, test } from "vitest";
import {
  clampDivider,
  dividerFor,
  dividerSaveFailedText,
  dividersLoadFailedText,
  roundDivider,
} from "../src/pageDivider";

describe("page divider model", () => {
  test("clampDivider keeps the ratio within the limits", () => {
    expect(clampDivider(0)).toBe(0.05);
    expect(clampDivider(1.7)).toBe(0.95);
    expect(clampDivider(0.4)).toBe(0.4);
  });

  test("roundDivider clamps, then keeps 3 decimals", () => {
    expect(roundDivider(0.61234)).toBe(0.612);
    expect(roundDivider(0.4996)).toBe(0.5);
    expect(roundDivider(2)).toBe(0.95);
  });

  test("dividerFor clamps and ignores pages that do not exist", () => {
    const dividers = { 1: 0.3, 3: 1.7, 4: 0.2 };
    expect(dividerFor(dividers, 1, 4)).toBe(0.3);
    expect(dividerFor(dividers, 2, 4)).toBe(0.5);
    expect(dividerFor(dividers, 3, 4)).toBe(0.95);
    expect(dividerFor(dividers, 4, 4)).toBe(0.5);
    expect(dividerFor(dividers, 0, 4)).toBe(0.5);
  });

  test("texts", () => {
    expect(dividersLoadFailedText(".config.json", "kaputt", false)).toBe(
      "Die Seitenteiler können nicht verschoben werden: „.config.json“ kann nicht gelesen werden: kaputt",
    );
    expect(dividersLoadFailedText(".config.json", "kaputt", true)).toBe(
      "Die Seitenteiler können nicht verschoben werden: „.config.json“ stammt von einer neueren Version der App. Bitte die App aktualisieren.",
    );
    expect(dividerSaveFailedText("Zugriff verweigert")).toBe(
      "Der Seitenteiler konnte nicht gespeichert werden: Zugriff verweigert. Er gilt nur, bis das Blatt geschlossen wird.",
    );
  });
});
