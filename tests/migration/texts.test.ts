import { describe, expect, test } from "vitest";
import type { GateFailed } from "../../src/migration/gate";
import {
  backupLine,
  CANCELLED_TEXT,
  CHECK_TEXT,
  CHOOSE_FOLDER_BUTTON,
  CLOSE_BUTTON,
  FAILED_TITLE,
  failedHeadline,
  failureText,
  progressLine,
  RECHECK_BUTTON,
  SCAN_TEXT,
  summaryLine,
} from "../../src/migration/texts";
import type { GateFailure, GateFailureReason } from "../../src/migration/types";

describe("texts", () => {
  test("summary singular and plural", () => {
    expect(summaryLine(1)).toBe("1 Datei übernommen.");
    expect(summaryLine(0)).toBe("0 Dateien übernommen.");
    expect(summaryLine(7)).toBe("7 Dateien übernommen.");
  });

  test("backup and progress lines", () => {
    expect(backupLine("Markierungen-Backup 2026-11-20 10-00.zip")).toBe("Sicherung: Markierungen-Backup 2026-11-20 10-00.zip");
    expect(progressLine(3, 214)).toBe("3 von 214");
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

  test("renderFailed with and without a message", () => {
    expect(failureText(f("renderFailed", { sidecarName: ".Africa.data", message: "canvas too large" }))).toBe(
      "Die Markierungen aus „.Africa.data“ konnten nicht gezeichnet werden: canvas too large. Bitte erneut prüfen; bleibt der Fehler, die Datei löschen und die Markierungen neu eintragen.",
    );
    expect(failureText(f("renderFailed", { sidecarName: ".Africa.data" }))).toBe(
      "Die Markierungen aus „.Africa.data“ konnten nicht gezeichnet werden. Bitte erneut prüfen; bleibt der Fehler, die Datei löschen und die Markierungen neu eintragen.",
    );
    expect(failureText(f("renderFailed", { sidecarName: ".a.data", message: "Kein Speicher." }))).toBe(
      "Die Markierungen aus „.a.data“ konnten nicht gezeichnet werden: Kein Speicher. Bitte erneut prüfen; bleibt der Fehler, die Datei löschen und die Markierungen neu eintragen.",
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
      "Die PDF kann nicht gelesen werden: Invalid PDF structure. Bitte mit einem anderen Programm neu speichern.",
    );
    expect(failureText(f("unparseable"))).toBe("Die PDF kann nicht gelesen werden. Bitte mit einem anderen Programm neu speichern.");
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
    // An empty or blank message counts as none.
    expect(failureText(f("other", { message: "" }))).toBe("Unbekannter Fehler.");
    expect(failureText(f("other", { message: "  " }))).toBe("Unbekannter Fehler.");
    expect(failureText(f("folderUnreadable", { message: "" }))).toBe("Der Ordner kann nicht gelesen werden.");
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
    expect(failureText(f("unparseable", { message: "Gesperrt." }))).toBe(
      "Die PDF kann nicht gelesen werden: Gesperrt. Bitte mit einem anderen Programm neu speichern.",
    );
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

  test("check stage with only folder or link failures: the scan was incomplete", () => {
    expect(failedHeadline(failed({ total: 0, failures: [f("folderUnreadable", { relativePath: "." })] }))).toBe(
      "Der Notenordner konnte nicht vollständig geprüft werden. Es wurde nichts verändert.",
    );
    // Folders and links are no files: also with candidates that all passed.
    const scanOnly = [f("folderUnreadable", { relativePath: "Pop" }), f("linkUnreadable", { relativePath: "Link" })];
    expect(failedHeadline(failed({ total: 214, failures: scanOnly }))).toBe(
      "Der Notenordner konnte nicht vollständig geprüft werden. Es wurde nichts verändert.",
    );
  });

  test("an entry without a path (a run that threw, a sheet that could not be left) is no file", () => {
    const unexpected = { relativePath: null, reason: "other" as const, message: "boom" };
    expect(failedHeadline(failed({ total: 0, failures: [unexpected] }))).toBe("Es wurde nichts verändert.");
  });

  test("check stage with folder and file failures: both sentences, only files counted", () => {
    expect(failedHeadline(failed({ failures: [f("linkUnreadable", { relativePath: "Link" }), failure] }))).toBe(
      "Der Notenordner konnte nicht vollständig geprüft werden. 1 von 214 Dateien hat ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.",
    );
    expect(
      failedHeadline(failed({ failures: [f("folderUnreadable", { relativePath: "Pop" }), failure, failure] })),
    ).toBe(
      "Der Notenordner konnte nicht vollständig geprüft werden. 2 von 214 Dateien haben ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.",
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

  test("write stage counts only file problems; a backup failure alone names no file problem", () => {
    const backupFailed = f("backupFailed", { relativePath: null, message: "voll" });
    expect(failedHeadline(failed({ stage: "write", migrated: 0, total: 2, failures: [backupFailed] }))).toBe(
      "0 von 2 Dateien übernommen.",
    );
    expect(
      failedHeadline(failed({ stage: "write", migrated: 1, total: 3, zipName: "z.zip", failures: [backupFailed, failure, failure] })),
    ).toBe("1 von 3 Dateien übernommen. Sicherung: z.zip. 2 Dateien haben ein Problem.");
  });

  test("renderFailed counts as a file problem", () => {
    const render = f("renderFailed", { sidecarName: ".a.data", message: "x" });
    expect(failedHeadline(failed({ failures: [render] }))).toBe(
      "1 von 214 Dateien hat ein Problem. Es wurde nichts verändert. Bitte beheben und erneut prüfen.",
    );
    expect(failedHeadline(failed({ stage: "write", migrated: 2, total: 3, zipName: null, failures: [render] }))).toBe(
      "2 von 3 Dateien übernommen. 1 Datei hat ein Problem.",
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
    expect(CANCELLED_TEXT).toBe("Die Übernahme wurde abgebrochen. Die Markierungen sind noch nicht vollständig übernommen.");
  });
});
