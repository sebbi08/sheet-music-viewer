/** Notices about the set lists in the sheet folder's `.config.json` (spec 2026-11-22). No imports: unit-tested. */

/** The set lists could not be loaded; until they can, changes to them are not saved. */
export const setListsUnreadableText = (file: string, message: string) =>
  `Die Setlisten konnten nicht geladen werden („${file}“: ${message}). Änderungen an Setlisten werden nicht gespeichert.`;

/** The file was written by a newer version of the app; until the app is updated, changes are not saved. */
export const setListsNewerVersionText =
  "Die Setlisten stammen von einer neueren Version der App. Bitte die App aktualisieren; Änderungen an Setlisten werden nicht gespeichert.";

/** Saving the set lists failed; a message that already ends with a period gets no second one. */
export const setListsSaveFailedText = (message: string) =>
  `Die Setlisten konnten nicht gespeichert werden: ${message}${message.endsWith(".") ? "" : "."}`;

/** A save found other set lists on disk than the ones it was based on; they were loaded again. */
export const setListsChangedText =
  "Die Setlisten wurden inzwischen an einem anderen PC geändert und neu geladen. Bitte die letzte Änderung wiederholen.";
