import { defineStore } from "pinia";
import { FavoriteSaves } from "../favoriteSaves";
import { rendererSheetKey } from "../favoriteKey";
import type { FavoriteSheet, LoadSheetSettingsResult } from "../sheetSettings";
import { client } from "../trcpClient";
import { favoriteSaveFailedText, favoritesUnreadableText } from "./favoriteTexts";
import { useNotices } from "./notices";
import useStore from "./index";

type Current = {
  pdfPath: string;
  state: "ok" | "outside" | "unreadable";
  favorite: boolean;
  error: string | null;
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

let saves: FavoriteSaves | null = null;
const savesOf = (): FavoriteSaves => {
  if (saves !== null) return saves;
  const split = (id: string) => {
    const at = id.indexOf("\n");
    return { folder: id.slice(0, at), key: id.slice(at + 1) };
  };
  return (saves = new FavoriteSaves(
    async (id, favorite) => {
      const { folder } = split(id);
      const pdfPath = useFavorites().pendingPaths.get(id)!;
      const r = await client.setFavorite.mutate({ folder, pdfPath, favorite });
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    (id, favorite, revert) => {
      const { folder, key } = split(id);
      const store = useFavorites();
      if (useStore().sheetMusicFolder !== folder) return;
      const without = store.keys.filter((k) => k !== key);
      store.keys = favorite ? [...without, key] : without;
      if (store.current !== null && rendererSheetKey(folder, store.current.pdfPath) === key)
        store.current.favorite = favorite;
      if (!favorite) store.list = store.list.filter((f) => f.key !== key);
      else if (revert) void store.loadList();
    },
    (message) => useNotices().show(favoriteSaveFailedText(message)),
  ));
};
/** The `relinkMissingFavorites` run in flight per folder. */
const relinking = new Map<string, Promise<number>>();

export const useFavorites = defineStore("favorites", {
  state: () => ({
    keys: [] as string[],
    keysError: null as string | null,
    list: [] as FavoriteSheet[],
    listError: null as string | null,
    current: null as Current | null,
    /** The PDF path of each id with a save in flight (`folder\nkey`). */
    pendingPaths: new Map<string, string>(),
  }),
  actions: {
    async loadKeys() {
      const folder = useStore().sheetMusicFolder;
      if (!folder) {
        this.keys = [];
        this.keysError = null;
        return;
      }
      try {
        const r = await client.loadFavoriteKeys.query(folder);
        if (useStore().sheetMusicFolder !== folder) return;
        if (r.kind === "ok") {
          this.keys = r.keys;
          this.keysError = null;
        } else {
          this.keys = [];
          this.keysError = favoritesUnreadableText(r.file, r.message, r.newerVersion === true);
        }
      } catch (e) {
        if (useStore().sheetMusicFolder !== folder) return;
        this.keys = [];
        this.keysError = favoritesUnreadableText(".config.json", errorMessage(e), false);
      }
    },

    async loadList() {
      const folder = useStore().sheetMusicFolder;
      if (!folder) {
        this.list = [];
        this.listError = null;
        return;
      }
      const load = async () => {
        try {
          const r = await client.loadFavorites.query(folder);
          if (useStore().sheetMusicFolder !== folder) return;
          if (r.kind === "ok") {
            this.list = r.favorites;
            this.listError = null;
          } else {
            this.list = [];
            this.listError = favoritesUnreadableText(r.file, r.message, r.newerVersion === true);
          }
        } catch (e) {
          if (useStore().sheetMusicFolder !== folder) return;
          this.list = [];
          this.listError = favoritesUnreadableText(".config.json", errorMessage(e), false);
        }
      };
      await load();
      if (useStore().sheetMusicFolder !== folder || this.listError !== null) return;
      let run = relinking.get(folder);
      const started = run === undefined;
      if (run === undefined) {
        run = client.relinkMissingFavorites
          .mutate(folder)
          .then((r) => r.moved)
          .catch((e) => {
            console.warn("relinkMissingFavorites failed:", e);
            return 0;
          })
          .finally(() => relinking.delete(folder));
        relinking.set(folder, run);
      }
      const moved = await run;
      if (started && moved > 0 && useStore().sheetMusicFolder === folder) await load();
    },

    setCurrent(pdfPath: string, result: LoadSheetSettingsResult) {
      if (result.kind === "ok") this.current = { pdfPath, state: "ok", favorite: result.favorite, error: null };
      else if (result.kind === "outside") this.current = { pdfPath, state: "outside", favorite: false, error: null };
      else
        this.current = {
          pdfPath,
          state: "unreadable",
          favorite: false,
          error: favoritesUnreadableText(result.file, result.message, result.newerVersion === true),
        };
    },

    isFavorite(pdfPath: string): boolean {
      const key = rendererSheetKey(useStore().sheetMusicFolder, pdfPath);
      return key !== null && this.keys.includes(key);
    },

    async set(pdfPath: string, favorite: boolean) {
      const folder = useStore().sheetMusicFolder;
      const key = rendererSheetKey(folder, pdfPath);
      if (key === null) return;
      this.pendingPaths.set(`${folder}\n${key}`, pdfPath);
      // The state shown before the press: the open sheet's own (it may have moved, or the keys are not
      // loaded), else the folder view's.
      const shown =
        this.current !== null && rendererSheetKey(folder, this.current.pdfPath) === key
          ? this.current.favorite
          : this.isFavorite(pdfPath);
      await savesOf().set(`${folder}\n${key}`, favorite, shown);
    },
  },
});
