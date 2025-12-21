/**
 * In-memory implementation of DeltaRepository
 *
 * Manages delta relationships with efficient chain traversal and cycle detection.
 */

import type { DeltaEntry, DeltaRepository } from "@webrun-vcs/sandbox";

/**
 * In-memory delta repository
 *
 * Maintains delta relationships and a dependents index for efficient
 * queries about delta chains and dependencies.
 */
export class InMemoryDeltaRepository implements DeltaRepository {
  private deltas = new Map<number, DeltaEntry>();
  private dependents = new Map<number, Set<number>>();

  async get(objectRecordId: number): Promise<DeltaEntry | undefined> {
    return this.deltas.get(objectRecordId);
  }

  async set(entry: DeltaEntry): Promise<void> {
    this.deltas.set(entry.objectRecordId, entry);

    // Update dependents index
    if (!this.dependents.has(entry.baseRecordId)) {
      this.dependents.set(entry.baseRecordId, new Set());
    }
    const deps = this.dependents.get(entry.baseRecordId);
    if (deps) {
      deps.add(entry.objectRecordId);
    }
  }

  async has(objectRecordId: number): Promise<boolean> {
    return this.deltas.has(objectRecordId);
  }

  async delete(objectRecordId: number): Promise<void> {
    const entry = this.deltas.get(objectRecordId);
    if (!entry) {
      return;
    }

    this.deltas.delete(objectRecordId);

    // Clean up dependents index
    const deps = this.dependents.get(entry.baseRecordId);
    if (deps) {
      deps.delete(objectRecordId);
      if (deps.size === 0) {
        this.dependents.delete(entry.baseRecordId);
      }
    }
  }

  async getChain(objectRecordId: number): Promise<DeltaEntry[]> {
    const chain: DeltaEntry[] = [];
    let currentId = objectRecordId;
    const visited = new Set<number>();

    while (true) {
      // Prevent infinite loops
      if (visited.has(currentId)) {
        throw new Error(`Circular delta chain detected at record ${currentId}`);
      }
      visited.add(currentId);

      const deltaEntry = this.deltas.get(currentId);
      if (!deltaEntry) {
        // Reached base (no delta entry)
        break;
      }

      chain.push(deltaEntry);
      currentId = deltaEntry.baseRecordId;

      // Safety limit
      if (chain.length > 1000) {
        throw new Error(`Delta chain too deep (>1000) for record ${objectRecordId}`);
      }
    }

    return chain;
  }

  async getBaseRecordId(objectRecordId: number): Promise<number | undefined> {
    const entry = this.deltas.get(objectRecordId);
    return entry?.baseRecordId;
  }

  async getDependents(baseRecordId: number): Promise<number[]> {
    const deps = this.dependents.get(baseRecordId);
    return deps ? Array.from(deps) : [];
  }

  async hasDependents(baseRecordId: number): Promise<boolean> {
    const deps = this.dependents.get(baseRecordId);
    return deps ? deps.size > 0 : false;
  }

  async getChainDepth(objectRecordId: number): Promise<number> {
    const chain = await this.getChain(objectRecordId);
    return chain.length;
  }

  async wouldCreateCycle(objectRecordId: number, proposedBaseId: number): Promise<boolean> {
    // Self-reference is always a cycle
    if (proposedBaseId === objectRecordId) {
      return true;
    }

    // Walk the proposed base's chain to see if it contains objectRecordId
    const chain = await this.getChain(proposedBaseId);

    // Check if any entry in the chain points back to our object
    for (const entry of chain) {
      if (entry.objectRecordId === objectRecordId) {
        return true;
      }
      // Also check if the base of any entry is our object
      if (entry.baseRecordId === objectRecordId) {
        return true;
      }
    }

    return false;
  }
}
