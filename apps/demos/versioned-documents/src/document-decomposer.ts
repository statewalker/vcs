/**
 * Document Decomposer
 *
 * Handles DOCX/ODF file decomposition using JSZip.
 */

import JSZip from "jszip";

/**
 * Document components extracted from a DOCX/ODF file
 */
export interface DocumentComponents {
  /** Map of file paths to their content */
  files: Map<string, Uint8Array>;
  /** Document metadata */
  metadata: {
    type: "docx" | "odf" | "unknown";
    fileName: string;
    fileCount: number;
  };
}

/**
 * Decompose a document file (DOCX or ODF) into its components.
 *
 * Both DOCX and ODF files are ZIP archives containing XML files and media.
 */
export async function decomposeDocument(file: File): Promise<DocumentComponents> {
  const zip = await JSZip.loadAsync(file);
  const files = new Map<string, Uint8Array>();

  // Extract all files from the archive
  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (!zipEntry.dir) {
      const content = await zipEntry.async("uint8array");
      files.set(path, content);
    }
  }

  // Detect document type
  const type = detectDocumentType(files);

  return {
    files,
    metadata: {
      type,
      fileName: file.name,
      fileCount: files.size,
    },
  };
}

/**
 * Reconstruct a document from its components.
 */
export async function reconstructDocument(
  files: Map<string, Uint8Array>,
  fileName: string,
): Promise<Blob> {
  const zip = new JSZip();

  for (const [path, content] of files) {
    zip.file(path, content);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: getMimeType(fileName),
  });

  return blob;
}

/**
 * Detect document type from its contents.
 */
function detectDocumentType(files: Map<string, Uint8Array>): "docx" | "odf" | "unknown" {
  // DOCX has [Content_Types].xml
  if (files.has("[Content_Types].xml")) {
    return "docx";
  }

  // ODF has mimetype file
  if (files.has("mimetype")) {
    return "odf";
  }

  return "unknown";
}

/**
 * Get MIME type for a file.
 */
function getMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop();
  switch (ext) {
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    default:
      return "application/octet-stream";
  }
}

/**
 * Get file type category for display.
 */
export function getFileCategory(path: string): "xml" | "media" | "other" {
  const ext = path.toLowerCase().split(".").pop();
  if (ext === "xml" || ext === "rels") {
    return "xml";
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "emf", "wmf"].includes(ext || "")) {
    return "media";
  }
  return "other";
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
