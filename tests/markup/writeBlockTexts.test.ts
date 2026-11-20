import { describe, expect, test } from "vitest";
import {
  WRITE_BLOCK_BUTTON,
  WRITE_BLOCK_READABLE,
  WRITE_BLOCK_TITLE,
  writeBlockText,
} from "../../src/markup/writeBlockTexts";

describe("writeBlockTexts", () => {
  test("encrypted", () => {
    expect(writeBlockText({ reason: "encrypted" })).toBe("Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.");
  });

  test("readOnly", () => {
    expect(writeBlockText({ reason: "readOnly" })).toBe(
      "Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen.",
    );
  });

  test("unparseable with and without a message", () => {
    expect(writeBlockText({ reason: "unparseable", message: "Invalid PDF structure" })).toBe(
      "Die PDF kann nicht gelesen werden: Invalid PDF structure.",
    );
    expect(writeBlockText({ reason: "unparseable" })).toBe("Die PDF kann nicht gelesen werden.");
  });

  test("structure", () => {
    expect(writeBlockText({ reason: "structure", message: "startxref zeigt ins Leere" })).toBe(
      "In diese PDF kann die App nicht schreiben: startxref zeigt ins Leere. Bitte mit einem anderen Programm neu speichern.",
    );
  });

  test("a message that already ends in a period gets no second one", () => {
    expect(writeBlockText({ reason: "unparseable", message: "Kaputt." })).toBe("Die PDF kann nicht gelesen werden: Kaputt.");
    expect(writeBlockText({ reason: "structure", message: "Kaputt." })).toBe(
      "In diese PDF kann die App nicht schreiben: Kaputt. Bitte mit einem anderen Programm neu speichern.",
    );
  });

  test("constants", () => {
    expect(WRITE_BLOCK_TITLE).toBe("Keine Markierungen möglich");
    expect(WRITE_BLOCK_READABLE).toBe("Die Noten lassen sich trotzdem anzeigen.");
    expect(WRITE_BLOCK_BUTTON).toBe("Verstanden");
  });
});
