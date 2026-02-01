// Shared types (includes deprecated CheckoutStore for backward compatibility)

// New Checkout interface (Phase C4)
export * from "./checkout.js";
// Legacy implementations (for backward compatibility)
export * from "./checkout-store.files.js";
export * from "./checkout-store.memory.js";
// New Checkout implementations (Phase C4)
export * from "./git-checkout.js";
export * from "./memory-checkout.js";
export * from "./types.js";
