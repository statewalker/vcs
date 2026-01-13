/**
 * Utilities Module
 *
 * Core utilities for the MVC architecture:
 * - BaseClass: Observable state pattern for models
 * - newAdapter: Typed context accessors for dependency injection
 * - newRegistry: Cleanup management for views and controllers
 */

export { newAdapter } from "./adapter.js";
export { BaseClass } from "./base-class.js";
export { newRegistry } from "./registry.js";
