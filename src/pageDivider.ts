/** Model of the movable page divider (spec 2026-11-23). No `node:` and no Electron imports: the renderer uses it. */

export const DEFAULT_DIVIDER = 0.5;
export const MIN_DIVIDER = 0.05;
export const MAX_DIVIDER = 0.95;

/** Page left of a turn -> divider ratio, as stored (unclamped). */
export type PageDividers = Record<number, number>;

export function clampDivider(ratio: number): number {
  return Math.min(MAX_DIVIDER, Math.max(MIN_DIVIDER, ratio));
}

/** Clamps, then keeps 3 decimals. */
export function roundDivider(ratio: number): number {
  return Math.round(clampDivider(ratio) * 1000) / 1000;
}

/** Ratio for the turn `page` -> `page + 1`; DEFAULT_DIVIDER unless 1 <= page < pageCount and set. */
export function dividerFor(dividers: PageDividers, page: number, pageCount: number): number {
  if (!(page >= 1 && page < pageCount)) return DEFAULT_DIVIDER;
  const ratio = dividers[page];
  return typeof ratio === "number" && Number.isFinite(ratio) ? clampDivider(ratio) : DEFAULT_DIVIDER;
}

/** The dividers could not be loaded, so they cannot be moved. */
export const dividersLoadFailedText = (file: string, message: string, newerVersion: boolean) =>
  newerVersion
    ? `Die Seitenteiler können nicht verschoben werden: „${file}“ stammt von einer neueren Version der App. Bitte die App aktualisieren.`
    : `Die Seitenteiler können nicht verschoben werden: „${file}“ kann nicht gelesen werden: ${message}`;

/** Saving a divider failed; a message that already ends with a period gets no second one. */
export const dividerSaveFailedText = (message: string) =>
  `Der Seitenteiler konnte nicht gespeichert werden: ${message.replace(/\.$/, "")}. Er gilt nur, bis das Blatt geschlossen wird.`;
