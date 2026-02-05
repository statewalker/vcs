/**
 * Utilities Module
 *
 * Core utilities for the MVC architecture:
 * - BaseClass: Observable state pattern for models
 * - newAdapter: Typed context accessors for dependency injection
 * - newRegistry: Cleanup management for views and controllers
 * - Transport helpers: VCS transport API adapters for WebRTC
 */

export { newAdapter } from "./adapter.js";
export { BaseClass } from "./base-class.js";
export { newRegistry } from "./registry.js";
export {
  createDataChannelDuplex,
  createRefStoreAdapter,
  createRepositoryContext,
  fetchFromPeer,
  pushToPeer,
  servePeer,
} from "./transport-helpers.js";
