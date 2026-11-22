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

/**
 * Whether a sheet folder counts as migrated: its `.config.json` is readable and holds `markupMigrated`.
 * `unreadable`: the settings file (`file`, its basename) cannot be read; the gate lists it as a failure.
 */
export type MigratedState = "migrated" | "notMigrated" | { unreadable: { file: string; message: string } };

/** Why one file (or the scan, or the backup) keeps the migration gate shut. */
export type GateFailureReason =
  | "dataDamaged"
  | "renderFailed"
  | "dataUnreadable"
  | "conflict"
  | "encrypted"
  | "readOnly"
  | "unparseable"
  | "structure"
  | "locked"
  | "pendingChanges"
  | "folderUnreadable"
  | "linkUnreadable"
  | "configUnreadable"
  | "sidecarNotDeleted"
  | "backupFailed"
  | "other";

/** `relativePath` null: not about one file (backup). `sidecarName`: basename of the `.data` file, for the text. */
export interface GateFailure {
  relativePath: string | null;
  reason: GateFailureReason;
  message?: string;
  sidecarName?: string;
}
