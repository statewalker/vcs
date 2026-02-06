export * from "./tag-format.js";
export * from "./tag-store.impl.js";
// Legacy interface - export only TagStore (AnnotatedTag from new interface)
export type { TagStore } from "./tag-store.js";
// New implementations (Phase C2)
export * from "./tags.impl.js";
// New interfaces (Phase C) - primary source for AnnotatedTag, Tag, Tags
export * from "./tags.js";
