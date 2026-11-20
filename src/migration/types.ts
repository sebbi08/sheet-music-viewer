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
