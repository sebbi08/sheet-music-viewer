import { withDetail, writeBlockText } from "../markup/writeBlockTexts";
import type { GateFailed } from "./gate";
import type { FailureReason, GateFailure } from "./types";

export const FAILED_TITLE = "Markierungen konnten nicht übernommen werden";
export const SCAN_TEXT = "Notenordner wird geprüft …";
export const CHECK_TEXT = "Dateien werden geprüft …";
export const RECHECK_BUTTON = "Erneut prüfen";
export const CHOOSE_FOLDER_BUTTON = "Anderen Notenordner wählen";
export const CLOSE_BUTTON = "Schließen";

/** `„<name>“` with a leading space, or nothing without a name. */
const quoted = (name: string | undefined) => (name === undefined ? "" : ` „${name}“`);

/** What went wrong with one entry of the failure list, and what to do about it. */
export function failureText({ reason, message, sidecarName }: GateFailure): string {
  switch (reason) {
    case "dataDamaged":
      return `Die alte Markierungsdatei${quoted(sidecarName)} ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.`;
    case "dataUnreadable":
      return withDetail(`Die Markierungsdatei${quoted(sidecarName)} kann nicht gelesen werden`, message);
    case "conflict":
      return `Die PDF enthält bereits Markierungen. Bitte die Datei${quoted(sidecarName)} löschen; die Markierungen in der PDF bleiben.`;
    case "encrypted":
    case "readOnly":
    case "unparseable":
    case "structure":
      return writeBlockText({ reason, message });
    case "locked":
      return "Die Datei ist in einem anderen Programm geöffnet. Bitte dort schließen.";
    case "pendingChanges":
      return "Für diese Datei gibt es ungespeicherte Änderungen.";
    case "folderUnreadable":
      return withDetail("Der Ordner kann nicht gelesen werden", message);
    case "linkUnreadable":
      return "Die Verknüpfung führt zu einem Ziel, das nicht gelesen werden kann. Bitte entfernen oder das Ziel erreichbar machen.";
    case "sidecarNotDeleted":
      return withDetail(`Die PDF wurde übernommen, aber${quoted(sidecarName)} konnte nicht gelöscht werden`, message);
    case "backupFailed":
      return `${withDetail("Die Sicherung konnte nicht erstellt werden", message)} Es wurde nichts übernommen.`;
    case "other":
      return message ?? "Unbekannter Fehler.";
  }
}

/** Headline of the failure list. */
export function failedHeadline({ stage, total, migrated, zipName, failures }: GateFailed): string {
  const n = failures.length;
  const problems = n === 1 ? "1 Datei hat ein Problem." : `${n} Dateien haben ein Problem.`;
  if (stage === "write") {
    const backup = zipName === null ? "" : ` Sicherung: ${zipName}.`;
    return `${migrated} von ${total} Dateien übernommen.${backup} ${problems}`;
  }
  if (total === 0) return "Der Notenordner konnte nicht vollständig geprüft werden. Es wurde nichts verändert.";
  const checked = n === 1 ? `1 von ${total} Dateien hat ein Problem.` : `${n} von ${total} Dateien haben ein Problem.`;
  return `${checked} Es wurde nichts verändert. Bitte beheben und erneut prüfen.`;
}

export const DIALOG_TITLE = "Markierungen werden in die PDFs übernommen";
export const BACKUP_PHASE_TEXT = "Sicherung wird erstellt …";
export const CANCEL_BUTTON = "Abbrechen";
export const OK_BUTTON = "OK";
export const NOT_MIGRATED_HEADING = "Nicht übernommen:";
export const READ_ONLY_FOLDER_TEXT =
  "Der Notenordner ist schreibgeschützt. Die Markierungen bleiben in den .data-Dateien.";

export function progressLine(index: number, total: number): string {
  return `${index} von ${total}`;
}

export function summaryLine(migrated: number): string {
  return migrated === 1 ? "1 Datei übernommen." : `${migrated} Dateien übernommen.`;
}

export function backupLine(zipName: string): string {
  return `Sicherung: ${zipName}`;
}

export function cancelledLine(remaining: number): string {
  return remaining === 1
    ? "Abgebrochen. 1 Datei folgt beim nächsten Start."
    : `Abgebrochen. ${remaining} Dateien folgen beim nächsten Start.`;
}

export function backupFailedText(message: string): string {
  return `Die Sicherung konnte nicht erstellt werden (${message}). Es wurde nichts übernommen; beim nächsten Start wird es erneut versucht.`;
}

export function reasonText(reason: FailureReason, message?: string): string {
  switch (reason) {
    case "corruptData":
      return "Alte Markierungsdatei ist beschädigt";
    case "alreadyEmbedded":
      return "PDF enthält bereits Markierungen; alte Datei bleibt liegen";
    case "notWritable":
      return "PDF kann nicht beschrieben werden";
    case "locked":
      return "Datei ist in einem anderen Programm geöffnet";
    case "notBackedUp":
      return "Datei konnte nicht gesichert werden";
    case "pendingChanges":
      return "Ungespeicherte Änderungen; wird beim nächsten Start übernommen";
    case "other":
      return `Unbekannter Fehler: ${message ?? ""}`;
  }
}

export function failureLine(relativePath: string, reason: FailureReason, message?: string): string {
  return `${relativePath} – ${reasonText(reason, message)}`;
}
