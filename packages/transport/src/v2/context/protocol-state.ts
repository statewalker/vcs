/**
 * Accumulated state during protocol negotiation.
 *
 * This class holds the mutable state that builds up during
 * the Git protocol exchange. Both client and server FSMs
 * read from and write to this state.
 */
export class ProtocolState {
  /**
   * Remote refs advertised by the server.
   * Maps ref name (e.g., "refs/heads/main") to object ID.
   */
  refs = new Map<string, string>();

  /**
   * Object IDs that the client wants from the server.
   * Populated during the "want" phase.
   */
  wants = new Set<string>();

  /**
   * Object IDs that the client has locally.
   * Sent to server during negotiation.
   */
  haves = new Set<string>();

  /**
   * Common ancestors found during negotiation.
   * Objects both client and server have.
   * Server uses this to minimize pack size.
   */
  commonBase = new Set<string>();

  /**
   * Negotiated protocol capabilities.
   * e.g., "multi_ack_detailed", "side-band-64k", "thin-pack", "no-done"
   */
  capabilities = new Set<string>();

  /**
   * Checks if a specific capability is enabled.
   * @param cap - Capability name to check
   */
  hasCapability(cap: string): boolean {
    return this.capabilities.has(cap);
  }

  /**
   * Resets all accumulated state.
   * Useful for reusing the state object.
   */
  reset(): void {
    this.refs.clear();
    this.wants.clear();
    this.haves.clear();
    this.commonBase.clear();
    this.capabilities.clear();
  }
}
