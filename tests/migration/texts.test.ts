import { describe, expect, test } from "vitest";
import { backupFailedText, cancelledLine, failureLine, reasonText, summaryLine } from "../../src/migration/texts";
import type { FailureReason } from "../../src/migration/types";

describe("texts", () => {
  test("summary singular and plural", () => {
    expect(summaryLine(1)).toBe("1 Datei übernommen.");
    expect(summaryLine(0)).toBe("0 Dateien übernommen.");
    expect(summaryLine(7)).toBe("7 Dateien übernommen.");
  });

  test("cancelled singular and plural", () => {
    expect(cancelledLine(1)).toBe("Abgebrochen. 1 Datei folgt beim nächsten Start.");
    expect(cancelledLine(3)).toBe("Abgebrochen. 3 Dateien folgen beim nächsten Start.");
  });

  test("backup failure", () => {
    expect(backupFailedText("voll")).toBe(
      "Die Sicherung konnte nicht erstellt werden (voll). Es wurde nichts übernommen; beim nächsten Start wird es erneut versucht.",
    );
  });

  test("all reasons verbatim", () => {
    const expected: [FailureReason, string][] = [
      ["corruptData", "Alte Markierungsdatei ist beschädigt"],
      ["alreadyEmbedded", "PDF enthält bereits Markierungen; alte Datei bleibt liegen"],
      ["notWritable", "PDF kann nicht beschrieben werden"],
      ["locked", "Datei ist in einem anderen Programm geöffnet"],
      ["notBackedUp", "Datei konnte nicht gesichert werden"],
      ["pendingChanges", "Ungespeicherte Änderungen; wird beim nächsten Start übernommen"],
    ];
    for (const [reason, text] of expected) expect(reasonText(reason)).toBe(text);
    expect(reasonText("other", "boom")).toBe("Unbekannter Fehler: boom");
    expect(failureLine("x/a.pdf", "locked")).toBe("x/a.pdf – Datei ist in einem anderen Programm geöffnet");
  });
});
