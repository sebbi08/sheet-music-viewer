import { defineStore } from "pinia";

/**
 * App-wide snackbar messages (shown by App.vue), so a message outlives the view that raised it. One
 * message at a time; further ones wait, repeats of a shown or waiting message are dropped.
 */
export const useNotices = defineStore("notices", {
  state: () => ({ open: false, text: "", waiting: [] as string[] }),
  actions: {
    show(text: string) {
      if ((this.open && this.text === text) || this.waiting.includes(text)) return;
      if (this.open) {
        this.waiting.push(text);
        return;
      }
      this.text = text;
      this.open = true;
    },
    dismiss() {
      this.open = false;
      // Short pause so the closed snackbar can animate out before the next one opens.
      if (this.waiting.length > 0) setTimeout(() => this.showNext(), 300);
    },
    showNext() {
      const next = this.waiting.shift();
      if (next === undefined || this.open) {
        if (next !== undefined) this.waiting.unshift(next);
        return;
      }
      this.text = next;
      this.open = true;
    },
  },
});
