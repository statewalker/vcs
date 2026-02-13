/**
 * Typed intent adapter — mirrors the `newUserAction` pattern.
 *
 * Creates a paired [run, handle] tuple for type-safe intent dispatch
 * and handler registration.
 */

import type { Intent, IntentHandler, Intents } from "./types.js";

export function newIntent<P, R>(
  key: string,
): [
  run: (intents: Intents, payload: P) => Intent<P, R>,
  handle: (intents: Intents, handler: IntentHandler<P, R>) => () => void,
] {
  function run(intents: Intents, payload: P): Intent<P, R> {
    return intents.run<P, R>(key, payload);
  }

  function handle(intents: Intents, handler: IntentHandler<P, R>): () => void {
    return intents.addHandler<P, R>(key, handler);
  }

  return [run, handle];
}
