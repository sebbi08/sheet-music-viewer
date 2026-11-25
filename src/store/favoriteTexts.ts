/** Notices about favorites in the sheet folder's `.config.json` (spec 2026-11-25). No imports: unit-tested. */

/** Marking or unmarking a favorite could not be saved; a message that already ends with a period gets no second one. */
export const favoriteSaveFailedText = (message: string) =>
  `Der Favorit konnte nicht gespeichert werden: ${message}${message.endsWith(".") ? "" : "."}`;

/** The favorites could not be loaded; until they can, favorites are not saved. */
export const favoritesUnreadableText = (file: string, message: string, newerVersion: boolean) =>
  newerVersion
    ? "Die Favoriten stammen von einer neueren Version der App. Bitte die App aktualisieren; Änderungen an Favoriten werden nicht gespeichert."
    : `Die Favoriten konnten nicht geladen werden („${file}“: ${message}). Änderungen an Favoriten werden nicht gespeichert.`;

/** The main page's line for favorites whose PDF was not found. */
export const favoritesNotFoundText = (count: number) =>
  count === 1 ? "1 Favorit nicht gefunden" : `${count} Favoriten nicht gefunden`;
