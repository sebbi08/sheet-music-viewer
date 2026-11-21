import type { SaveFailureReason, WriteBlock } from "../models/markup";

export const WRITE_BLOCK_TITLE = "Keine Markierungen möglich";
export const WRITE_BLOCK_READABLE = "Die Noten lassen sich trotzdem anzeigen.";
export const WRITE_BLOCK_BUTTON = "Verstanden";

/** `message` as the end of a sentence: a message that already ends in a period gets no second one. */
export function endSentence(message: string): string {
  return message.endsWith(".") ? message : `${message}.`;
}

/** `<lead>: <message>.`, or `<lead>.` without a message. */
export function withDetail(lead: string, message: string | undefined): string {
  return message === undefined ? `${lead}.` : `${lead}: ${endSentence(message)}`;
}

/** Why markup cannot be saved into a PDF, and what to do about it. */
export function writeBlockText(block: WriteBlock): string {
  switch (block.reason) {
    case "encrypted":
      return "Die PDF ist verschlüsselt. Bitte den Kennwortschutz entfernen.";
    case "readOnly":
      return "Die PDF oder ihr Ordner ist schreibgeschützt. Bitte den Schreibschutz entfernen.";
    case "unparseable":
      return `${withDetail("Die PDF kann nicht gelesen werden", block.message)} Bitte mit einem anderen Programm neu speichern.`;
    case "structure":
      return `${withDetail("In diese PDF kann die App nicht schreiben", block.message)} Bitte mit einem anderen Programm neu speichern.`;
  }
}

const SAVE_RETRY = "Sie bleiben erhalten; es wird alle 30 Sekunden und beim nächsten Speichern erneut versucht.";

/** The notice for a failed save of the markup in `fileName`, by the save's reason (none: the save threw). */
export function saveFailedText(fileName: string, { reason, message }: { reason?: SaveFailureReason; message?: string }): string {
  const lead = `Markierungen in „${fileName}“ konnten nicht gespeichert werden`;
  switch (reason) {
    case undefined:
    case "locked":
      return `${lead} (ist die PDF in einem anderen Programm geöffnet?). ${SAVE_RETRY}`;
    case "encrypted":
    case "unparseable":
    case "readOnly":
    case "structure":
      return `${lead}: ${writeBlockText({ reason, message })} ${SAVE_RETRY}`;
    case "other":
      return `${withDetail(lead, message)} ${SAVE_RETRY}`;
  }
}
