/**
 * In-memory implementation of ObjectRepository
 *
 * Uses JavaScript Maps for fast lookups by both object ID and record ID.
 */

import type { ObjectId } from "../../interfaces/index.js";
import type { ObjectEntry, ObjectRepository } from "../index.js";

/**
 * In-memory object repository using Maps
 *
 * Maintains dual indexes for fast lookups:
 * - ObjectId → Entry (content hash lookup)
 * - RecordId → ObjectId (internal ID lookup)
 */
export class InMemoryObjectRepository implements ObjectRepository {
  private objects = new Map<ObjectId, ObjectEntry>();
  private recordIdIndex = new Map<number, ObjectId>();
  private nextRecordId = 1;

  async storeObject(entry: Omit<ObjectEntry, "recordId">): Promise<ObjectEntry> {
    // Check if already exists
    const existing = this.objects.get(entry.id);
    if (existing) {
      // Update existing entry (preserving recordId)
      const updated: ObjectEntry = {
        ...entry,
        recordId: existing.recordId,
      };
      this.objects.set(entry.id, updated);
      return updated;
    }

    // Create new entry with fresh recordId
    const recordId = this.nextRecordId++;
    const newEntry: ObjectEntry = {
      ...entry,
      recordId,
    };

    this.objects.set(entry.id, newEntry);
    this.recordIdIndex.set(recordId, entry.id);

    return newEntry;
  }

  async loadObjectEntry(objectId: ObjectId): Promise<ObjectEntry | undefined> {
    return this.objects.get(objectId);
  }

  async loadObjectByRecordId(recordId: number): Promise<ObjectEntry | undefined> {
    const objectId = this.recordIdIndex.get(recordId);
    return objectId ? this.objects.get(objectId) : undefined;
  }

  async loadObjectContent(recordId: number): Promise<Uint8Array | undefined> {
    const entry = await this.loadObjectByRecordId(recordId);
    return entry?.content;
  }

  async deleteObject(objectId: ObjectId): Promise<boolean> {
    const entry = this.objects.get(objectId);
    if (!entry) {
      return false;
    }

    this.objects.delete(objectId);
    this.recordIdIndex.delete(entry.recordId);
    return true;
  }

  async hasObject(objectId: ObjectId): Promise<boolean> {
    return this.objects.has(objectId);
  }

  async getMany(objectIds: ObjectId[]): Promise<ObjectEntry[]> {
    const result: ObjectEntry[] = [];
    for (const id of objectIds) {
      const entry = this.objects.get(id);
      if (entry) {
        result.push(entry);
      }
    }
    return result;
  }

  async size(): Promise<number> {
    return this.objects.size;
  }

  async getAllIds(): Promise<ObjectId[]> {
    return Array.from(this.objects.keys());
  }
}
