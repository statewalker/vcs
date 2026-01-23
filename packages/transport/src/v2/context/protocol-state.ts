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

  // Protocol V2 specific state

  /**
   * Protocol version negotiated with the server.
   * 1 for V1, 2 for V2.
   */
  protocolVersion?: number;

  /**
   * Capability values for capabilities with parameters.
   * e.g., "fetch=shallow filter" would store "shallow filter" under "fetch".
   */
  capabilityValues?: Map<string, string>;

  /**
   * Symbolic ref targets.
   * Maps ref name to its target ref name.
   * e.g., "HEAD" -> "refs/heads/main"
   */
  symrefs?: Map<string, string>;

  /**
   * Peeled tag targets.
   * Maps tag ref to the OID of the dereferenced object.
   */
  peeled?: Map<string, string>;

  /**
   * Refs the client wants to fetch, mapped to their OIDs.
   * Used with want-ref protocol V2 extension.
   */
  wantedRefs?: Map<string, string>;

  /**
   * Whether client has sent "done" command.
   * In V2, client sends "done" to signal end of negotiation.
   */
  sentDone?: boolean;

  /**
   * Current section being processed in fetch response.
   * One of: "acknowledgments", "shallow-info", "wanted-refs", "packfile-uris"
   */
  currentSection?: string;

  /**
   * Whether server signaled "ready" to send packfile.
   */
  serverReady?: boolean;

  /**
   * Client's shallow boundaries.
   * Commits that the client has shallowly.
   */
  clientShallow?: Set<string>;

  /**
   * Commits that the server wants to unshallow.
   * Sent in shallow-info section.
   */
  serverUnshallow?: Set<string>;

  /**
   * Server's shallow boundaries (for server FSM).
   */
  serverShallow?: Set<string>;

  /**
   * Resolved wanted-refs from the server response.
   * Maps ref name to resolved OID.
   */
  resolvedWantedRefs?: Map<string, string>;

  /**
   * Packfile URIs for CDN-based pack fetching.
   */
  packfileUris?: string[];

  /**
   * Current command being processed (server-side).
   * One of: "ls-refs", "fetch", "object-info"
   */
  currentCommand?: string;

  /**
   * ACKed object IDs during negotiation.
   */
  acks?: string[];

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
    this.protocolVersion = undefined;
    this.capabilityValues = undefined;
    this.symrefs = undefined;
    this.peeled = undefined;
    this.wantedRefs = undefined;
    this.sentDone = undefined;
    this.currentSection = undefined;
    this.serverReady = undefined;
    this.clientShallow = undefined;
    this.serverUnshallow = undefined;
    this.serverShallow = undefined;
    this.resolvedWantedRefs = undefined;
    this.packfileUris = undefined;
    this.currentCommand = undefined;
    this.acks = undefined;
  }
}
