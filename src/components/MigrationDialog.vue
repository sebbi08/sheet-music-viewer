<template>
  <!-- Blocks the app while the gate runs, has failed or was cancelled: no closing by Escape or a click next to it. -->
  <v-dialog :model-value="visible" persistent no-click-animation max-width="640" scrollable>
    <v-card data-testid="migration-dialog">
      <v-card-title class="migration-title">{{ stopped ? FAILED_TITLE : DIALOG_TITLE }}</v-card-title>

      <v-card-text v-if="phase.phase === 'scanning'" data-testid="migration-progress">
        <p class="mb-2">{{ SCAN_TEXT }}</p>
        <v-progress-linear indeterminate color="primary" height="8" rounded />
      </v-card-text>

      <v-card-text v-else-if="files" data-testid="migration-progress">
        <p v-if="phase.phase === 'checking'" class="mb-2">{{ CHECK_TEXT }}</p>
        <div class="progress-row">
          <v-progress-linear :model-value="percent(files.index, files.total)" color="primary" height="8" rounded />
          <span class="progress-count">{{ progressLine(files.index, files.total) }}</span>
        </div>
        <div class="current-file">{{ files.current }}</div>
      </v-card-text>

      <v-card-text v-else-if="backup" data-testid="migration-progress">
        <p class="mb-2">{{ BACKUP_PHASE_TEXT }}</p>
        <v-progress-linear :model-value="percent(backup.doneBytes, backup.totalBytes)"
          :indeterminate="backup.totalBytes === 0" color="primary" height="8" rounded />
      </v-card-text>

      <v-card-text v-else-if="summary" data-testid="migration-summary" :data-migrated="summary.migrated">
        <p>{{ summaryLine(summary.migrated) }}</p>
        <p v-if="summary.zipName">{{ backupLine(summary.zipName) }}</p>
      </v-card-text>

      <v-card-text v-else-if="failed" data-testid="migration-failed" class="failed">
        <p data-testid="migration-headline" class="mb-3">{{ failedHeadline(failed) }}</p>
        <ul class="failures">
          <li v-for="(failure, i) in failed.failures" :key="i" data-testid="migration-failure">
            <div v-if="failure.relativePath !== null" class="failure-path">{{ failure.relativePath }}</div>
            <div class="failure-text">{{ failureText(failure) }}</div>
          </li>
        </ul>
      </v-card-text>

      <v-card-text v-else-if="phase.phase === 'cancelled'" data-testid="migration-cancelled">
        <p>{{ CANCELLED_TEXT }}</p>
      </v-card-text>

      <v-card-actions class="actions">
        <v-spacer></v-spacer>
        <v-btn v-if="summary" data-testid="migration-ok" color="primary" @click="bulkMigration.dismiss()">
          {{ OK_BUTTON }}
        </v-btn>
        <template v-else-if="stopped">
          <v-btn data-testid="migration-recheck" color="primary" @click="bulkMigration.recheck()">
            {{ RECHECK_BUTTON }}
          </v-btn>
          <v-btn data-testid="migration-choose-folder" @click="bulkMigration.chooseOtherFolder()">
            {{ CHOOSE_FOLDER_BUTTON }}
          </v-btn>
          <v-btn data-testid="migration-close" @click="bulkMigration.close()">
            {{ CLOSE_BUTTON }}
          </v-btn>
        </template>
        <v-btn v-else data-testid="migration-cancel" :disabled="cancelling" @click="bulkMigration.cancel()">
          {{ CANCEL_BUTTON }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  BACKUP_PHASE_TEXT,
  backupLine,
  CANCEL_BUTTON,
  CANCELLED_TEXT,
  CHECK_TEXT,
  CHOOSE_FOLDER_BUTTON,
  CLOSE_BUTTON,
  DIALOG_TITLE,
  FAILED_TITLE,
  failedHeadline,
  failureText,
  OK_BUTTON,
  progressLine,
  RECHECK_BUTTON,
  SCAN_TEXT,
  summaryLine,
} from "../migration/texts";
import { useBulkMigration } from "../store/bulkMigration";

/** A scan shorter than this shows no window (a folder without `.data` files must not flash it up). */
const SCAN_DIALOG_DELAY_MS = 300;

const bulkMigration = useBulkMigration();
const { phase, cancelling } = storeToRefs(bulkMigration);

const files = computed(() => (phase.value.phase === "checking" || phase.value.phase === "migrating" ? phase.value : null));
const backup = computed(() => (phase.value.phase === "backup" ? phase.value : null));
const summary = computed(() => (phase.value.phase === "done" ? phase.value.summary : null));
const failed = computed(() => (phase.value.phase === "failed" ? phase.value.result : null));
/** Failure list or cancelled run: the gate is shut and the user chooses how to go on. */
const stopped = computed(() => failed.value !== null || phase.value.phase === "cancelled");

const visible = ref(false);
let showTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => phase.value.phase,
  (current) => {
    clearTimeout(showTimer);
    if (current === "idle") visible.value = false;
    // A window already up (e.g. "Erneut prüfen") stays up.
    else if (current === "scanning" && !visible.value) showTimer = setTimeout(() => (visible.value = true), SCAN_DIALOG_DELAY_MS);
    else visible.value = true;
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(showTimer));

const percent = (done: number, total: number) => (total > 0 ? (100 * done) / total : 0);
</script>

<style lang="less" scoped>
.migration-title {
  white-space: normal;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-count {
  white-space: nowrap;
}

.current-file,
.failure-path {
  word-break: break-all;
}

.current-file {
  margin-top: 8px;
}

/* The list can be selected and copied (cards are user-select: none app-wide). */
.failed {
  user-select: text;
}

.failures {
  list-style: none;
  padding-left: 0;

  li + li {
    margin-top: 8px;
  }
}

.failure-path {
  font-weight: 500;
}

.failure-text {
  padding-left: 16px;
}

.actions {
  flex-wrap: wrap;
}
</style>
