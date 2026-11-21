import { describe, expect, test } from "vitest";
import {
  WRITE_BLOCK_BUTTON,
  WRITE_BLOCK_READABLE,
  WRITE_BLOCK_TITLE,
  saveFailedText,
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
      "Die PDF kann nicht gelesen werden: Invalid PDF structure. Bitte mit einem anderen Programm neu speichern.",
    );
    expect(writeBlockText({ reason: "unparseable" })).toBe(
      "Die PDF kann nicht gelesen werden. Bitte mit einem anderen Programm neu speichern.",
    );
  });

  test("structure", () => {
    expect(writeBlockText({ reason: "structure", message: "startxref zeigt ins Leere" })).toBe(
      "In diese PDF kann die App nicht schreiben: startxref zeigt ins Leere. Bitte mit einem anderen Programm neu speichern.",
    );
  });

  test("a message that already ends in a period gets no second one", () => {
    expect(writeBlockText({ reason: "unparseable", message: "Kaputt." })).toBe(
      "Die PDF kann nicht gelesen werden: Kaputt. Bitte mit einem anderen Programm neu speichern.",
    );
    expect(writeBlockText({ reason: "structure", message: "Kaputt." })).toBe(
      "In diese PDF kann die App nicht schreiben: Kaputt. Bitte mit einem anderen Programm neu speichern.",
    );
  });

  test("constants", () => {
    expect(WRITE_BLOCK_TITLE).toBe("Keine Markierungen möglich");
    expect(WRITE_BLOCK_READABLE).toBe("Die Noten lassen sich trotzdem anzeigen.");
    expect(WRITE_BLOCK_BUTTON).toBe("Verstanden");
  });

  describe("saveFailedText", () => {
    const RETRY = "Sie bleiben erhalten; es wird alle 30 Sekunden und beim nächsten Speichern erneut versucht.";

    test("locked or no reason: the text about another program", () => {
      const text =
        "Markierungen in „a.pdf“ konnten nicht gespeichert werden (ist die PDF in einem anderen Programm geöffnet?). " + RETRY;
      expect(saveFailedText("a.pdf", { reason: "locked", message: "EBUSY: resource busy" })).toBe(text);
      expect(saveFailedText("a.pdf", { message: "IPC gone" })).toBe(text);
      expect(saveFailedText("a.pdf", {})).toBe(text);
    });

    test("a write block reason: its text", () => {
      expect(saveFailedText("a.pdf", { reason: "encrypted" })).toBe(
        `Markierungen in „a.pdf“ konnten nicht gespeichert werden: Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen. ${RETRY}`,
      );
      expect(saveFailedText("a.pdf", { reason: "readOnly", message: "EACCES" })).toBe(
        `Markierungen in „a.pdf“ konnten nicht gespeichert werden: Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen. ${RETRY}`,
      );
      expect(saveFailedText("a.pdf", { reason: "unparseable", message: "No PDF header found" })).toBe(
        `Markierungen in „a.pdf“ konnten nicht gespeichert werden: ${writeBlockText({ reason: "unparseable", message: "No PDF header found" })} ${RETRY}`,
      );
      expect(saveFailedText("a.pdf", { reason: "structure", message: "verification failed" })).toBe(
        `Markierungen in „a.pdf“ konnten nicht gespeichert werden: In diese PDF kann die App nicht schreiben: verification failed. Bitte mit einem anderen Programm neu speichern. ${RETRY}`,
      );
    });

    test("other: the message, ended once, or none", () => {
      expect(saveFailedText("a.pdf", { reason: "other", message: "ENOSPC: no space left on device" })).toBe(
        `Markierungen in „a.pdf“ konnten nicht gespeichert werden: ENOSPC: no space left on device. ${RETRY}`,
      );
      expect(saveFailedText("a.pdf", { reason: "other", message: "Kein Platz." })).toBe(
        `Markierungen in „a.pdf“ konnten nicht gespeichert werden: Kein Platz. ${RETRY}`,
      );
      expect(saveFailedText("a.pdf", { reason: "other" })).toBe(`Markierungen in „a.pdf“ konnten nicht gespeichert werden. ${RETRY}`);
    });
  });
});
