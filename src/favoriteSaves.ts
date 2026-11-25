/**
 * Serialized favorite saves per id (no Pinia, no tRPC: unit-tested). Every press applies its state at once
 * and is saved after the earlier ones of the same id. When the last queued save of an id has run, a failure
 * is reported once and the state goes back to the last confirmed (saved) state; a failure that a later
 * successful save superseded shows nothing.
 */
export type SaveResult = { ok: true } | { ok: false; message: string };

interface Chain {
  confirmed: boolean;
  latest: boolean;
  pending: number;
  tail: Promise<void>;
}

export class FavoriteSaves {
  private chains = new Map<string, Chain>();

  constructor(
    private readonly save: (id: string, favorite: boolean) => Promise<SaveResult>,
    private readonly apply: (id: string, favorite: boolean, revert: boolean) => void,
    private readonly notify: (message: string) => void,
  ) {}

  /** `current` is the state shown before this press; it seeds the confirmed state of an idle id. */
  set(id: string, favorite: boolean, current: boolean): Promise<void> {
    let chain = this.chains.get(id);
    if (chain === undefined) {
      chain = { confirmed: current, latest: favorite, pending: 0, tail: Promise.resolve() };
      this.chains.set(id, chain);
    }
    const c = chain;
    c.latest = favorite;
    c.pending++;
    this.apply(id, favorite, false);
    const run = c.tail.then(async () => {
      let result: SaveResult;
      try {
        result = await this.save(id, favorite);
      } catch (e) {
        result = { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
      if (result.ok) c.confirmed = favorite;
      c.pending--;
      if (c.pending > 0) return;
      this.chains.delete(id);
      if (result.ok) return;
      if (c.confirmed !== c.latest) this.apply(id, c.confirmed, true);
      this.notify(result.message);
    });
    c.tail = run;
    return run;
  }
}
