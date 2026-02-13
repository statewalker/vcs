/**
 * Open Repository intent — asks the external layer to provide a FilesApi
 * for persistent storage (desktop: File System Access, mobile: in-memory).
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { newIntent } from "./new-intent.js";

export interface OpenRepositoryParams {
  /** Hint shown in the UI dialog (optional). */
  title?: string;
}

export interface OpenRepositoryResult {
  /** The resolved FilesApi for the chosen folder. */
  files: FilesApi;
  /** Human-readable label (folder name / "In-Memory"). */
  label: string;
}

export const [runOpenRepositoryIntent, handleOpenRepositoryIntent] = newIntent<
  OpenRepositoryParams,
  OpenRepositoryResult
>("intent:open-repository");
