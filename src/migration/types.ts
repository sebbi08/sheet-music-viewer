export interface MigrationCandidate {
  pdfPath: string;
  sidecarPath: string;
  /** Relative to the sheet folder, always with `/`. */
  relativePath: string;
}

/** A folder or link the scan could not read. `relativePath` uses `/`; the root itself is `"."`. */
export interface ScanError {
  relativePath: string;
  kind: "folder" | "link";
  message: string;
}

export interface ScanResult {
  candidates: MigrationCandidate[];
  errors: ScanError[];
}

export type FailureReason =
  | "corruptData"
  | "alreadyEmbedded"
  | "notWritable"
  | "locked"
  | "notBackedUp"
  | "pendingChanges"
  | "other";

/** Failures that will not go away by retrying; they are remembered until the files change. */
export const PERMANENT_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "corruptData",
  "alreadyEmbedded",
  "notWritable",
]);
