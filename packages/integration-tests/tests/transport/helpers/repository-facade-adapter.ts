/**
 * RepositoryFacade adapter for transport integration tests
 *
 * Creates a RepositoryFacade from a HistoryStore for use in
 * transport operations (fetch, push).
 */

import type { HistoryStore } from "@statewalker/vcs-core";
import {
  createRepositoryFacade as createFacadeFromStores,
  type RepositoryFacade,
} from "@statewalker/vcs-transport";

/**
 * Creates a RepositoryFacade from a HistoryStore
 *
 * The RepositoryFacade provides transport-layer operations:
 * - importPack: Import objects from a pack stream
 * - exportPack: Export objects as a pack stream
 * - has: Check if an object exists
 * - walkAncestors: Walk commit ancestry for negotiation
 *
 * @param repository HistoryStore from createGitRepository
 * @returns RepositoryFacade for transport operations
 * @throws Error if repository has no backend (required for serialization)
 *
 * @example
 * ```typescript
 * const repository = await createGitRepository(...);
 * const facade = createRepositoryFacade(repository);
 *
 * // Check object existence
 * const exists = await facade.has(commitId);
 *
 * // Export objects as pack
 * const pack = facade.exportPack(new Set([wantOid]), new Set([haveOid]));
 * ```
 */
export function createRepositoryFacade(repository: HistoryStore): RepositoryFacade {
  if (!repository.backend) {
    throw new Error(
      "Repository must have a backend for transport operations. " +
        "Use createGitRepository() to create a repository with a backend.",
    );
  }

  return createFacadeFromStores({
    objects: repository.objects,
    commits: repository.commits,
    tags: repository.tags,
    refs: repository.refs,
    serialization: repository.backend.serialization,
  });
}
