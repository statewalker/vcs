/**
 * Pack file handling (re-export from new location)
 *
 * Pack utilities have been moved to backend/git/pack/ as they
 * are Git-specific binary format handling, not generic storage.
 *
 * This module re-exports for backwards compatibility.
 *
 * @deprecated Import from backend/git/pack instead
 */
export * from "../../backend/git/pack/index.js";
