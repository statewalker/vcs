/**
 * RepositoryFacade adapter for transport integration tests
 *
 * Creates a RepositoryFacade from a HistoryWithOperations for use in
 * transport operations (fetch, push).
 */

import type { HistoryWithOperations } from "@statewalker/vcs-core";
import {
  createRepositoryFacade as createFacadeFromHistory,
  type RepositoryFacade,
} from "@statewalker/vcs-transport";

/**
 * Creates a RepositoryFacade from a HistoryWithOperations
 *
 * The RepositoryFacade provides transport-layer operations:
 * - importPack: Import objects from a pack stream
 * - exportPack: Export objects as a pack stream
 * - has: Check if an object exists
 * - walkAncestors: Walk commit ancestry for negotiation
 *
 * @param history HistoryWithOperations instance
 * @returns RepositoryFacade for transport operations
 *
 * @example
 * ```typescript
 * const history = createHistoryWithOperations({ backend });
 * const facade = createRepositoryFacade(history);
 *
 * // Check object existence
 * const exists = await facade.has(commitId);
 *
 * // Export objects as pack
 * const pack = facade.exportPack(new Set([wantOid]), new Set([haveOid]));
 * ```
 */
export function createRepositoryFacade(history: HistoryWithOperations): RepositoryFacade {
  return createFacadeFromHistory({ history });
}
