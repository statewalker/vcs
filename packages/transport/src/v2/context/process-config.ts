/**
 * Configuration options for FSM execution.
 *
 * Read-only settings that control FSM behavior.
 * Set before starting the FSM run.
 */
export class ProcessConfiguration {
  /**
   * Maximum number of "have" commands to send during negotiation.
   * Prevents excessive negotiation on large repositories.
   * @default 256
   */
  maxHaves?: number;

  /**
   * Local HEAD ref to start ancestry walk from.
   * Client uses this to find local commits to send as "have".
   * @example "refs/heads/main"
   */
  localHead?: string;

  /**
   * Refs that should be fetched/updated.
   * Maps remote ref name to object ID.
   * After successful fetch, these refs are updated locally.
   */
  wantedRefs?: Map<string, string>;

  /**
   * Server capabilities to advertise.
   * Only used by server-side FSM.
   */
  serverCapabilities?: string[];

  /**
   * Whether to use thin packs.
   * Thin packs can reference objects the receiver has
   * but aren't in the pack itself.
   * @default true
   */
  thinPack?: boolean;

  /**
   * Whether to enable sideband multiplexing.
   * Allows progress messages alongside pack data.
   * @default true
   */
  sideBand?: boolean;

  /**
   * Progress callback for reporting transfer status.
   * @param message - Progress message to display
   */
  onProgress?: (message: string) => void;

  // Push configuration

  /**
   * Refspecs for push operation.
   * Format: "[+]src:dst" where + means force push
   * @example ["refs/heads/main:refs/heads/main", "+refs/heads/feature:refs/heads/feature"]
   */
  pushRefspecs?: string[];

  /**
   * Whether to use atomic push mode.
   * All refs are updated together or none are updated.
   * @default false
   */
  atomic?: boolean;

  /**
   * Push options to send to the server.
   * Requires server support for "push-options" capability.
   */
  pushOptions?: string[];

  /**
   * Suppress output/progress messages.
   * @default false
   */
  quiet?: boolean;

  // Server-side push configuration

  /**
   * Whether to allow ref deletions on the server.
   * @default true
   */
  allowDeletes?: boolean;

  /**
   * Whether to allow non-fast-forward updates on the server.
   * @default false
   */
  allowNonFastForward?: boolean;

  /**
   * Whether to deny updates to the currently checked-out branch.
   * @default true
   */
  denyCurrentBranch?: boolean;

  /**
   * The currently checked-out branch on the server.
   * Used with denyCurrentBranch to prevent updates.
   */
  currentBranch?: string;
}
