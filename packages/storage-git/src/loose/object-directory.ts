/**
 * Object directory manager
 *
 * Manages the .git/objects directory, providing high-level operations
 * for reading and writing loose objects.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/LooseObjects.java
 */

import type { ObjectId, ObjectTypeCode, ObjectTypeString } from "@webrun-vcs/storage";
import type { DirEntry, FileApi } from "../file-api/types.js";
import {
  hasLooseObject,
  type LooseObjectData,
  readLooseObject,
  readLooseObjectHeader,
} from "./loose-object-reader.js";
import { writeLooseObject } from "./loose-object-writer.js";

/**
 * Object store entry for enumeration
 */
export interface ObjectEntry {
  /** Object ID */
  id: ObjectId;
  /** Object type code */
  typeCode: ObjectTypeCode;
  /** Object size */
  size: number;
}

/**
 * Manages the loose object directory (.git/objects)
 *
 * This class provides a unified interface for:
 * - Reading loose objects
 * - Writing loose objects
 * - Checking object existence
 * - Enumerating objects
 */
export class ObjectDirectory {
  constructor(
    private readonly files: FileApi,
    private readonly objectsDir: string,
  ) {}

  /**
   * Get the objects directory path
   */
  getDirectory(): string {
    return this.objectsDir;
  }

  /**
   * Check if a loose object exists
   *
   * @param id Object ID
   * @returns True if object exists
   */
  async has(id: ObjectId): Promise<boolean> {
    return hasLooseObject(this.files, this.objectsDir, id);
  }

  /**
   * Read a loose object
   *
   * @param id Object ID
   * @returns Object data
   * @throws Error if object not found
   */
  async read(id: ObjectId): Promise<LooseObjectData> {
    return readLooseObject(this.files, this.objectsDir, id);
  }

  /**
   * Read object type and size (without full content)
   *
   * @param id Object ID
   * @returns Object header info
   */
  async readHeader(id: ObjectId): Promise<{ type: ObjectTypeCode; size: number }> {
    const header = await readLooseObjectHeader(this.files, this.objectsDir, id);
    return {
      type: header.typeCode,
      size: header.size,
    };
  }

  /**
   * Write a loose object
   *
   * @param type Object type
   * @param content Object content
   * @returns Object ID
   */
  async write(type: ObjectTypeString, content: Uint8Array): Promise<ObjectId> {
    return writeLooseObject(this.files, this.objectsDir, type, content);
  }

  /**
   * Write a blob object
   *
   * @param content Blob content
   * @returns Object ID
   */
  async writeBlob(content: Uint8Array): Promise<ObjectId> {
    return this.write("blob", content);
  }

  /**
   * Write a tree object
   *
   * @param content Serialized tree content
   * @returns Object ID
   */
  async writeTree(content: Uint8Array): Promise<ObjectId> {
    return this.write("tree", content);
  }

  /**
   * Write a commit object
   *
   * @param content Serialized commit content
   * @returns Object ID
   */
  async writeCommit(content: Uint8Array): Promise<ObjectId> {
    return this.write("commit", content);
  }

  /**
   * Write a tag object
   *
   * @param content Serialized tag content
   * @returns Object ID
   */
  async writeTag(content: Uint8Array): Promise<ObjectId> {
    return this.write("tag", content);
  }

  /**
   * Delete a loose object
   *
   * @param id Object ID
   * @returns True if object was deleted
   */
  async delete(id: ObjectId): Promise<boolean> {
    const prefix = id.substring(0, 2);
    const suffix = id.substring(2);
    const path = this.files.join(this.objectsDir, prefix, suffix);
    return this.files.unlink(path);
  }

  /**
   * List all loose object IDs
   *
   * @yields Object IDs
   */
  async *list(): AsyncGenerator<ObjectId> {
    // List all 2-character subdirectories
    let entries: DirEntry[] = [];
    try {
      entries = await this.files.readdir(this.objectsDir);
    } catch {
      return; // Objects directory doesn't exist
    }

    for (const entry of entries) {
      // Skip non-directories and special directories
      if (!entry.isDirectory || entry.name.length !== 2) {
        continue;
      }

      // Valid hex prefix?
      if (!/^[0-9a-f]{2}$/.test(entry.name)) {
        continue;
      }

      const prefix = entry.name;
      const subdir = this.files.join(this.objectsDir, prefix);

      let objects: DirEntry[] = [];
      try {
        objects = await this.files.readdir(subdir);
      } catch {
        continue;
      }

      for (const obj of objects) {
        if (!obj.isFile || obj.name.length !== 38) {
          continue;
        }

        // Valid hex suffix?
        if (!/^[0-9a-f]{38}$/.test(obj.name)) {
          continue;
        }

        yield prefix + obj.name;
      }
    }
  }

  /**
   * Enumerate all loose objects in the directory
   *
   * @yields Object entries (id, type, size)
   */
  async *enumerate(): AsyncGenerator<ObjectEntry> {
    // List all 2-character subdirectories
    let entries: DirEntry[] = [];
    try {
      entries = await this.files.readdir(this.objectsDir);
    } catch {
      return; // Objects directory doesn't exist
    }

    for (const entry of entries) {
      // Skip non-directories and special directories
      if (!entry.isDirectory || entry.name.length !== 2) {
        continue;
      }

      // Valid hex prefix?
      if (!/^[0-9a-f]{2}$/.test(entry.name)) {
        continue;
      }

      const prefix = entry.name;
      const subdir = this.files.join(this.objectsDir, prefix);

      let objects: DirEntry[] = [];
      try {
        objects = await this.files.readdir(subdir);
      } catch {
        continue;
      }

      for (const obj of objects) {
        if (!obj.isFile || obj.name.length !== 38) {
          continue;
        }

        // Valid hex suffix?
        if (!/^[0-9a-f]{38}$/.test(obj.name)) {
          continue;
        }

        const id = prefix + obj.name;

        try {
          const header = await this.readHeader(id);
          yield {
            id,
            typeCode: header.type,
            size: header.size,
          };
        } catch {
          // Skip corrupt objects
        }
      }
    }
  }

  /**
   * Create the objects directory structure
   */
  async create(): Promise<void> {
    await this.files.mkdir(this.objectsDir);
    // Pre-create some common subdirectories (optional optimization)
    // Git doesn't require this, but it can speed up initial writes
  }
}

/**
 * Create an ObjectDirectory instance
 *
 * @param files FileApi instance
 * @param objectsDir Path to objects directory
 */
export function createObjectDirectory(files: FileApi, objectsDir: string): ObjectDirectory {
  return new ObjectDirectory(files, objectsDir);
}
