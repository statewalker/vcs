/**
 * Intent dispatcher factory.
 *
 * Creates an Intents instance backed by a Map<key, Set<handler>>.
 * When `run()` is called:
 *   1. A deferred-promise Intent object is created
 *   2. Handlers for that key are iterated; first one returning `true` claims it
 *   3. If none handled, the intent is rejected with "Unhandled intent: <key>"
 */

import type { Intent, IntentHandler, Intents } from "./types.js";

export function createIntents(): Intents {
  const handlers = new Map<string, Set<IntentHandler>>();

  function run<P, R>(key: string, payload: P): Intent<P, R> {
    let resolveFn!: (value: R | Promise<R>) => void;
    let rejectFn!: (error?: Error) => void;
    let resolved = false;

    const promise = new Promise<R>((resolve, reject) => {
      resolveFn = (value: R | Promise<R>) => {
        resolved = true;
        resolve(value as R);
      };
      rejectFn = (error?: Error) => {
        resolved = true;
        reject(error);
      };
    });

    const intent: Intent<P, R> = {
      key,
      payload,
      resolve: resolveFn,
      reject: rejectFn,
      promise,
      get resolved() {
        return resolved;
      },
    };

    const keyHandlers = handlers.get(key);
    if (keyHandlers && keyHandlers.size > 0) {
      let claimed = false;
      for (const handler of keyHandlers) {
        if ((handler as IntentHandler<P, R>)(intent)) {
          claimed = true;
          break;
        }
      }
      if (!claimed) {
        rejectFn(new Error(`Unhandled intent: ${key}`));
      }
    } else {
      rejectFn(new Error(`Unhandled intent: ${key}`));
    }

    return intent;
  }

  function addHandler<P = unknown, R = unknown>(
    key: string,
    handler: IntentHandler<P, R>,
  ): () => void {
    let keyHandlers = handlers.get(key);
    if (!keyHandlers) {
      keyHandlers = new Set();
      handlers.set(key, keyHandlers);
    }
    keyHandlers.add(handler as IntentHandler);
    return () => keyHandlers.delete(handler as IntentHandler);
  }

  return { run, addHandler };
}
