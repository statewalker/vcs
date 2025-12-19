/**
 * Core type definitions for object storage
 *
 * These types form the foundation for all object storage interfaces.
 */

/**
 * Object identifier (content hash in hex format)
 *
 * SHA-256: 64 hex characters (256 bits / 4 bits per char)
 * SHA-1: 40 hex characters (160 bits / 4 bits per char)
 */
export type ObjectId = string;

/**
 * Object metadata returned by storage operations
 */
export type ObjectInfo = {
  /** Object ID (content hash in hex) */
  id: ObjectId;
  /** Uncompressed content size in bytes */
  size: number;
};

/**
 * Git object type codes matching JGit Constants
 */
export const ObjectType = {
  COMMIT: 1,
  TREE: 2,
  BLOB: 3,
  TAG: 4,
} as const;

export type ObjectTypeCode = (typeof ObjectType)[keyof typeof ObjectType];

/**
 * Git object type string representations
 */
export type ObjectTypeString = "commit" | "tree" | "blob" | "tag";

/**
 * File mode constants (following Git/JGit patterns)
 *
 * These are octal values stored in tree entries:
 * - Trees (directories) use 040000
 * - Regular files use 100644 (non-executable) or 100755 (executable)
 * - Symbolic links use 120000
 * - Gitlinks (submodules) use 160000
 */
export const FileMode = {
  /** Directory (tree) */
  TREE: 0o040000,
  /** Regular file (non-executable) */
  REGULAR_FILE: 0o100644,
  /** Executable file */
  EXECUTABLE_FILE: 0o100755,
  /** Symbolic link */
  SYMLINK: 0o120000,
  /** Submodule (gitlink) */
  GITLINK: 0o160000,
} as const;

export type FileModeValue = (typeof FileMode)[keyof typeof FileMode];

/**
 * Person identity (author, committer, tagger)
 *
 * Following JGit's PersonIdent format:
 * "Name <email> timestamp timezone"
 * Example: "John Doe <john@example.com> 1234567890 +0100"
 */
export interface PersonIdent {
  /** Display name */
  name: string;
  /** Email address */
  email: string;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Timezone offset string: "+HHMM" or "-HHMM" */
  tzOffset: string;
}

/**
 * Git format constants
 */
export const GitFormat = {
  /** SHA-1 hash length in bytes */
  OBJECT_ID_LENGTH: 20,
  /** SHA-1 hash string length (hex) */
  OBJECT_ID_STRING_LENGTH: 40,
  /** SHA-256 hash length in bytes */
  OBJECT_ID_256_LENGTH: 32,
  /** SHA-256 hash string length (hex) */
  OBJECT_ID_256_STRING_LENGTH: 64,
} as const;
