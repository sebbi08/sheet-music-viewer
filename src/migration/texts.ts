import { withDetail, writeBlockText } from "../markup/writeBlockTexts";
import type { GateFailed } from "./gate";
import type { GateFailure } from "./types";

export const FAILED_TITLE = "Markierungen konnten nicht übernommen werden";
export const SCAN_TEXT = "Notenordner wird geprüft …";
export const CHECK_TEXT = "Dateien werden geprüft …";
export const RECHECK_BUTTON = "Erneut prüfen";
export const CHOOSE_FOLDER_BUTTON = "Anderen Notenordner wählen";
export const CLOSE_BUTTON = "Schließen";
export const CANCELLED_TEXT = "Die Übernahme wurde abgebrochen. Die Markierungen sind noch nicht vollständig übernommen.";

/** `„<name>“` with a leading space, or nothing without a name. */
const quoted = (name: string | undefined) => (name === undefined ? "" : ` „${name}“`);

/** What went wrong with one entry of the failure list, and what to do about it. */
export function failureText({ reason, message, sidecarName }: GateFailure): string {
  switch (reason) {
    case "dataDamaged":
      return `Die alte Markierungsdatei${quoted(sidecarName)} ist beschädigt. Bitte die Datei löschen und die Markierungen neu eintragen.`;
    case "renderFailed":
      return `${withDetail(`Die Markierungen aus${quoted(sidecarName)} konnten nicht gezeichnet werden`, message)} Bitte erneut prüfen; bleibt der Fehler, die Datei löschen und die Markierungen neu eintragen.`;
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

/** Failures that are not about one file: the scan's folders and links, the backup. */
const NOT_A_FILE: ReadonlySet<GateFailure["reason"]> = new Set<GateFailure["reason"]>([
  "folderUnreadable",
  "linkUnreadable",
  "backupFailed",
]);

/** Headline of the failure list. Only file problems count as "Dateien". */
export function failedHeadline({ stage, total, migrated, zipName, failures }: GateFailed): string {
  const n = failures.filter((f) => !NOT_A_FILE.has(f.reason)).length;
  const parts: string[] = [];
  if (stage === "write") {
    parts.push(`${migrated} von ${total} Dateien übernommen.`);
    if (zipName !== null) parts.push(`Sicherung: ${zipName}.`);
    if (n > 0) parts.push(n === 1 ? "1 Datei hat ein Problem." : `${n} Dateien haben ein Problem.`);
    return parts.join(" ");
  }
  if (failures.some((f) => f.reason === "folderUnreadable" || f.reason === "linkUnreadable")) {
    parts.push("Der Notenordner konnte nicht vollständig geprüft werden.");
  }
  if (n > 0) parts.push(n === 1 ? `1 von ${total} Dateien hat ein Problem.` : `${n} von ${total} Dateien haben ein Problem.`);
  parts.push("Es wurde nichts verändert.");
  if (n > 0) parts.push("Bitte beheben und erneut prüfen.");
  return parts.join(" ");
}

export const DIALOG_TITLE = "Markierungen werden in die PDFs übernommen";
export const BACKUP_PHASE_TEXT = "Sicherung wird erstellt …";
export const CANCEL_BUTTON = "Abbrechen";
export const OK_BUTTON = "OK";

export function progressLine(index: number, total: number): string {
  return `${index} von ${total}`;
}

export function summaryLine(migrated: number): string {
  return migrated === 1 ? "1 Datei übernommen." : `${migrated} Dateien übernommen.`;
}

export function backupLine(zipName: string): string {
  return `Sicherung: ${zipName}`;
}
