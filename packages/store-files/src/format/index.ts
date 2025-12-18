/**
 * Git object format serialization
 *
 * @deprecated This module is deprecated. Import from @webrun-vcs/vcs/format instead.
 *
 * The format utilities have been moved to the vcs package to enable
 * all storage backends to use them without circular dependencies.
 *
 * Migration guide:
 * - Before: import { serializeCommit } from "@webrun-vcs/store-files/format";
 * - After:  import { serializeCommit } from "@webrun-vcs/vcs/format";
 *
 * This module re-exports from @webrun-vcs/vcs/format for backwards compatibility.
 */

/** @deprecated Import from @webrun-vcs/vcs/format instead */
export * from "./commit-format.js";
/** @deprecated Import from @webrun-vcs/vcs/format instead */
export * from "./object-header.js";
/** @deprecated Import from @webrun-vcs/vcs/format instead */
export * from "./person-ident.js";
/** @deprecated Import from @webrun-vcs/vcs/format instead */
export * from "./tag-format.js";
/** @deprecated Import from @webrun-vcs/vcs/format instead */
export * from "./tree-format.js";
