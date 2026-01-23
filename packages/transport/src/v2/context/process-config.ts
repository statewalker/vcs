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
}
