/**
 * Loose object handling
 *
 * Manages individual Git objects stored as compressed files
 * in .git/objects/XX/YYYYYY... format.
 */

export * from "./loose-object-reader.js";
export * from "./loose-object-writer.js";
export * from "./object-directory.js";
