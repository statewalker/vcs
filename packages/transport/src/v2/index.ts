/**
 * Transport v2 - FSM-based Git protocol implementation.
 *
 * Architecture:
 * - Explicit FSM with tuple transitions [source, event, target]
 * - Separate concerns: TransportApi (I/O), RepositoryFacade (storage), ProtocolState (negotiation)
 * - Stop states for HTTP protocol adaptation
 * - Parameterized adapters (HTTP, MessagePort) sharing same FSM logic
 *
 * @module
 */

// API interfaces
export * from "./api/index.js";
// Context types
export * from "./context/index.js";
// FSM core
export * from "./fsm/index.js";
