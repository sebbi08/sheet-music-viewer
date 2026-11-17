import type { FailureReason } from "./types";

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
