import { describe, expect, test } from "vitest";
import type { GateFailed } from "../../src/migration/gate";
import {
  backupFailedText,
  cancelledLine,
  CHECK_TEXT,
  CHOOSE_FOLDER_BUTTON,
  CLOSE_BUTTON,
  FAILED_TITLE,
  failedHeadline,
  failureLine,
  failureText,
  READ_ONLY_FOLDER_TEXT,
  reasonText,
  RECHECK_BUTTON,
  SCAN_TEXT,
  summaryLine,
} from "../../src/migration/texts";
import type { FailureReason, GateFailure, GateFailureReason } from "../../src/migration/types";

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

  test("read-only sheet folder", () => {
    expect(READ_ONLY_FOLDER_TEXT).toBe("Der Notenordner ist schreibgeschützt. Die Markierungen bleiben in den .data-Dateien.");
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

const f = (reason: GateFailureReason, over: Partial<GateFailure> = {}): GateFailure => ({
  relativePath: "Pop/Africa.pdf",
  reason,
  ...over,
});

describe("failureText", () => {
  test("dataDamaged", () => {
    expect(failureText(f("dataDamaged", { sidecarName: ".Africa.data" }))).toBe(
      "Die alte Markierungsdatei „.Africa.data“ ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.",
    );
  });

  test("dataUnreadable", () => {
    expect(failureText(f("dataUnreadable", { sidecarName: ".Africa.data", message: "EACCES: permission denied" }))).toBe(
      "Die Markierungsdatei „.Africa.data“ kann nicht gelesen werden: EACCES: permission denied.",
    );
  });

  test("conflict", () => {
    expect(failureText(f("conflict", { sidecarName: ".Africa.data" }))).toBe(
      "Die PDF enthält bereits Markierungen. Bitte die Datei „.Africa.data“ löschen; die Markierungen in der PDF bleiben.",
    );
  });

  test("encrypted, readOnly, unparseable and structure read like the write block", () => {
    expect(failureText(f("encrypted"))).toBe("Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.");
    expect(failureText(f("readOnly"))).toBe(
      "Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen.",
    );
    expect(failureText(f("unparseable", { message: "Invalid PDF structure" }))).toBe(
      "Die PDF kann nicht gelesen werden: Invalid PDF structure.",
    );
    expect(failureText(f("unparseable"))).toBe("Die PDF kann nicht gelesen werden.");
    expect(failureText(f("structure", { message: "startxref fehlt" }))).toBe(
      "In diese PDF kann die App nicht schreiben: startxref fehlt. Bitte mit einem anderen Programm neu speichern.",
    );
  });

  test("locked", () => {
    expect(failureText(f("locked"))).toBe("Die Datei ist in einem anderen Programm geöffnet. Bitte dort schließen.");
  });

  test("pendingChanges", () => {
    expect(failureText(f("pendingChanges"))).toBe("Für diese Datei gibt es ungespeicherte Änderungen.");
  });

  test("folderUnreadable", () => {
    expect(failureText(f("folderUnreadable", { relativePath: "Pop", message: "EACCES" }))).toBe(
      "Der Ordner kann nicht gelesen werden: EACCES.",
    );
  });

  test("linkUnreadable", () => {
    expect(failureText(f("linkUnreadable", { relativePath: "Link", message: "ENOENT" }))).toBe(
      "Die Verknüpfung führt zu einem Ziel, das nicht gelesen werden kann. Bitte entfernen oder das Ziel erreichbar machen.",
    );
  });

  test("sidecarNotDeleted", () => {
    expect(failureText(f("sidecarNotDeleted", { sidecarName: ".Africa.data", message: "EBUSY" }))).toBe(
      "Die PDF wurde übernommen, aber „.Africa.data“ konnte nicht gelöscht werden: EBUSY.",
    );
  });

  test("backupFailed", () => {
    expect(failureText(f("backupFailed", { relativePath: null, message: "Nicht lesbar: b.pdf" }))).toBe(
      "Die Sicherung konnte nicht erstellt werden: Nicht lesbar: b.pdf. Es wurde nichts übernommen.",
    );
  });

  test("other: the message verbatim, without one a generic text", () => {
    expect(failureText(f("other", { message: "Festplatte voll" }))).toBe("Festplatte voll");
    expect(failureText(f("other"))).toBe("Unbekannter Fehler.");
  });

  test("a message that already ends in a period gets no second one", () => {
    expect(failureText(f("dataUnreadable", { sidecarName: ".a.data", message: "Gesperrt." }))).toBe(
      "Die Markierungsdatei „.a.data“ kann nicht gelesen werden: Gesperrt.",
    );
    expect(failureText(f("folderUnreadable", { message: "Gesperrt." }))).toBe("Der Ordner kann nicht gelesen werden: Gesperrt.");
    expect(failureText(f("sidecarNotDeleted", { sidecarName: ".a.data", message: "Gesperrt." }))).toBe(
      "Die PDF wurde übernommen, aber „.a.data“ konnte nicht gelöscht werden: Gesperrt.",
    );
    expect(failureText(f("backupFailed", { message: "Gesperrt." }))).toBe(
      "Die Sicherung konnte nicht erstellt werden: Gesperrt. Es wurde nichts übernommen.",
    );
    expect(failureText(f("unparseable", { message: "Gesperrt." }))).toBe("Die PDF kann nicht gelesen werden: Gesperrt.");
  });
});

describe("failedHeadline", () => {
  const failure = f("locked");
  const failed = (over: Partial<GateFailed>): GateFailed => ({
    status: "failed",
    stage: "check",
    total: 214,
    migrated: 0,
    zipName: null,
    failures: [failure, failure, failure],
    ...over,
  });

  test("check stage: plural and singular", () => {
    expect(failedHeadline(failed({}))).toBe(
      "3 von 214 Dateien haben ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.",
    );
    expect(failedHeadline(failed({ failures: [failure] }))).toBe(
      "1 von 214 Dateien hat ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.",
    );
  });

  test("check stage without any file: the scan was incomplete", () => {
    expect(failedHeadline(failed({ total: 0, failures: [f("folderUnreadable", { relativePath: "." })] }))).toBe(
      "Der Notenordner konnte nicht vollständig geprüft werden. Es wurde nichts verändert.",
    );
  });

  test("write stage with and without a zip", () => {
    const zipName = "Markierungen-Backup 2026-11-16 10-00.zip";
    expect(failedHeadline(failed({ stage: "write", migrated: 211, zipName }))).toBe(
      "211 von 214 Dateien übernommen. Sicherung: Markierungen-Backup 2026-11-16 10-00.zip. 3 Dateien haben ein Problem.",
    );
    expect(failedHeadline(failed({ stage: "write", migrated: 0, zipName: null }))).toBe(
      "0 von 214 Dateien übernommen. 3 Dateien haben ein Problem.",
    );
  });

  test("write stage with one problem: singular", () => {
    expect(failedHeadline(failed({ stage: "write", migrated: 2, total: 3, zipName: "z.zip", failures: [failure] }))).toBe(
      "2 von 3 Dateien übernommen. Sicherung: z.zip. 1 Datei hat ein Problem.",
    );
  });
});

describe("gate constants", () => {
  test("verbatim", () => {
    expect(FAILED_TITLE).toBe("Markierungen konnten nicht übernommen werden");
    expect(SCAN_TEXT).toBe("Notenordner wird geprüft …");
    expect(CHECK_TEXT).toBe("Dateien werden geprüft …");
    expect(RECHECK_BUTTON).toBe("Erneut prüfen");
    expect(CHOOSE_FOLDER_BUTTON).toBe("Anderen Notenordner wählen");
    expect(CLOSE_BUTTON).toBe("Schließen");
  });
});
