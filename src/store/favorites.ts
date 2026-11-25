import { defineStore } from "pinia";
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

/** Saves per key run one after another (last press wins). */
const saveChains = new Map<string, Promise<unknown>>();
/** The `relinkMissingFavorites` run in flight per folder. */
const relinking = new Map<string, Promise<number>>();

export const useFavorites = defineStore("favorites", {
  state: () => ({
    keys: [] as string[],
    keysError: null as string | null,
    list: [] as FavoriteSheet[],
    listError: null as string | null,
    current: null as Current | null,
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
      const before = this.isFavorite(pdfPath);
      const applyKeys = (on: boolean) => {
        const without = this.keys.filter((k) => k !== key);
        this.keys = on ? [...without, key] : without;
      };
      const applyCurrent = (on: boolean) => {
        if (this.current?.pdfPath === pdfPath) this.current.favorite = on;
      };
      const apply = (on: boolean) => {
        applyKeys(on);
        applyCurrent(on);
        if (!on) this.list = this.list.filter((f) => f.key !== key);
      };
      apply(favorite);
      const chainKey = `${folder}\n${key}`;
      const task = (saveChains.get(chainKey) ?? Promise.resolve()).then(async () => {
        let message: string | null = null;
        try {
          const r = await client.setFavorite.mutate({ folder, pdfPath, favorite });
          if (!r.ok) message = r.message;
        } catch (e) {
          message = errorMessage(e);
        }
        if (message === null || useStore().sheetMusicFolder !== folder) return;
        // Revert only if no later press changed the state meanwhile.
        if (this.isFavorite(pdfPath) === favorite) {
          applyKeys(before);
          applyCurrent(before);
          if (before) void this.loadList();
        }
        useNotices().show(favoriteSaveFailedText(message));
      });
      saveChains.set(chainKey, task);
      await task;
      if (saveChains.get(chainKey) === task) saveChains.delete(chainKey);
    },
  },
});
