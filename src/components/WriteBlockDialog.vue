<template>
  <!-- Why markup cannot be saved into the open PDF; the sheet itself stays readable. -->
  <v-dialog v-if="block" v-model="open" max-width="560">
    <v-card data-testid="write-block-dialog">
      <v-card-title class="write-block-title">{{ WRITE_BLOCK_TITLE }}</v-card-title>
      <v-card-text data-testid="write-block-text">
        <p class="mb-2">{{ reasonLine(block) }}</p>
        <p>{{ WRITE_BLOCK_READABLE }}</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn data-testid="write-block-ok" color="primary" @click="open = false">{{ WRITE_BLOCK_BUTTON }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { WRITE_BLOCK_BUTTON, WRITE_BLOCK_READABLE, WRITE_BLOCK_TITLE, writeBlockText } from "../markup/writeBlockTexts";
import type { WriteBlock } from "../models/markup";

const props = defineProps<{
  /** The PDF's file name without its folder. */
  fileName: string;
  /** Nothing is shown without one. */
  block: WriteBlock | null;
}>();
const open = defineModel<boolean>({ required: true });

const reasonLine = (block: WriteBlock) =>
  `In „${props.fileName}“ können keine Markierungen gespeichert werden: ${writeBlockText(block)}`;
</script>

<style lang="less" scoped>
.write-block-title {
  white-space: normal;
}
</style>
