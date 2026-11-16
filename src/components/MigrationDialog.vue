<template>
  <!-- Blocks the app for the whole run: no closing by Escape or a click next to it. -->
  <v-dialog :model-value="open" persistent no-click-animation max-width="560" scrollable>
    <v-card data-testid="migration-dialog">
      <v-card-title class="migration-title">{{ DIALOG_TITLE }}</v-card-title>

      <v-card-text v-if="backup" data-testid="migration-progress">
        <p class="mb-2">{{ BACKUP_PHASE_TEXT }}</p>
        <v-progress-linear :model-value="percent(backup.doneBytes, backup.totalBytes)"
          :indeterminate="backup.totalBytes === 0" color="primary" height="8" rounded />
      </v-card-text>

      <v-card-text v-else-if="migrating" data-testid="migration-progress">
        <div class="progress-row">
          <v-progress-linear :model-value="percent(migrating.index, migrating.total)" color="primary" height="8"
            rounded />
          <span class="progress-count">{{ progressLine(migrating.index, migrating.total) }}</span>
        </div>
        <div class="current-file">{{ migrating.current }}</div>
      </v-card-text>

      <v-card-text v-else-if="summary" data-testid="migration-summary" :data-migrated="summary.migrated">
        <p v-if="summary.backupError !== null">{{ backupFailedText(summary.backupError) }}</p>
        <template v-else>
          <p>{{ summaryLine(summary.migrated) }}</p>
          <p v-if="summary.zipName">{{ backupLine(summary.zipName) }}</p>
        </template>
        <p v-if="summary.cancelledRemaining > 0" class="mt-2">{{ cancelledLine(summary.cancelledRemaining) }}</p>
        <template v-if="summary.failures.length > 0">
          <p class="mt-3 font-weight-bold">{{ NOT_MIGRATED_HEADING }}</p>
          <ul class="failures">
            <li v-for="failure in summary.failures" :key="failure.relativePath">
              {{ failureLine(failure.relativePath, failure.reason, failure.message) }}
            </li>
          </ul>
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn v-if="summary" data-testid="migration-ok" color="primary" @click="bulkMigration.dismiss()">
          {{ OK_BUTTON }}
        </v-btn>
        <v-btn v-else data-testid="migration-cancel" :disabled="cancelling" @click="bulkMigration.cancel()">
          {{ CANCEL_BUTTON }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed } from "vue";
import {
  BACKUP_PHASE_TEXT,
  backupFailedText,
  backupLine,
  CANCEL_BUTTON,
  cancelledLine,
  DIALOG_TITLE,
  failureLine,
  NOT_MIGRATED_HEADING,
  OK_BUTTON,
  progressLine,
  summaryLine,
} from "../migration/texts";
import { useBulkMigration } from "../store/bulkMigration";

const bulkMigration = useBulkMigration();
const { phase, cancelling } = storeToRefs(bulkMigration);

const open = computed(() => phase.value.phase !== "idle");
const backup = computed(() => (phase.value.phase === "backup" ? phase.value : null));
const migrating = computed(() => (phase.value.phase === "migrating" ? phase.value : null));
const summary = computed(() => (phase.value.phase === "done" ? phase.value.summary : null));

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
.failures li {
  word-break: break-all;
}

.current-file {
  margin-top: 8px;
}

.failures {
  padding-left: 20px;
}
</style>
