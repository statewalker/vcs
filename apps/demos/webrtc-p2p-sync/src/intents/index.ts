/**
 * Intent system — barrel export.
 *
 * Provides the intent dispatcher, typed adapter, and context integration.
 */

export { createIntents } from "./intents.js";
export { newIntent } from "./new-intent.js";
export type { Intent, IntentHandler, Intents } from "./types.js";

import { newAdapter } from "../utils/index.js";
import { createIntents } from "./intents.js";
import type { Intents } from "./types.js";

/** Context adapter for Intents — lazily created and shared across the app. */
export const [getIntents, setIntents] = newAdapter<Intents>("intents", () => createIntents());
