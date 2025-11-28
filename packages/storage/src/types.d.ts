/**
 * Object identifier (content hash in hex format)
 *
 * SHA-256: 64 hex characters (256 bits / 4 bits per char)
 * SHA-1: 40 hex characters (160 bits / 4 bits per char)
 */
export type ObjectId = string;
/**
 * Git object type codes matching JGit Constants
 */
export declare const ObjectType: {
    readonly COMMIT: 1;
    readonly TREE: 2;
    readonly BLOB: 3;
    readonly TAG: 4;
};
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
export declare const FileMode: {
    /** Directory (tree) */
    readonly TREE: 16384;
    /** Regular file (non-executable) */
    readonly REGULAR_FILE: 33188;
    /** Executable file */
    readonly EXECUTABLE_FILE: 33261;
    /** Symbolic link */
    readonly SYMLINK: 40960;
    /** Submodule (gitlink) */
    readonly GITLINK: 57344;
};
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
export declare const GitFormat: {
    /** SHA-1 hash length in bytes */
    readonly OBJECT_ID_LENGTH: 20;
    /** SHA-1 hash string length (hex) */
    readonly OBJECT_ID_STRING_LENGTH: 40;
    /** SHA-256 hash length in bytes */
    readonly OBJECT_ID_256_LENGTH: 32;
    /** SHA-256 hash string length (hex) */
    readonly OBJECT_ID_256_STRING_LENGTH: 64;
};
