/**
 * Intent system types.
 *
 * Intents flow outward from controllers to the external world (views, dialogs,
 * external services). A controller dispatches an intent when it needs something
 * it cannot do on its own — open a dialog, pick a file, call an external API.
 * A handler in the outer layer resolves it.
 */

/** A single dispatched intent waiting for resolution. */
export interface Intent<P, R> {
  readonly key: string;
  readonly payload: P;
  resolve(result: R | Promise<R>): void;
  reject(error?: Error): void;
  readonly promise: Promise<R>;
  readonly resolved: boolean;
}

/** Handler returns `true` when it claims the intent. */
export type IntentHandler<P = unknown, R = unknown> = (intent: Intent<P, R>) => boolean;

/** Global intent dispatcher / handler registry. */
export interface Intents {
  /** Dispatch an intent. Returns immediately; await `intent.promise` for the result. */
  run<P, R>(key: string, payload: P): Intent<P, R>;

  /** Register a handler. Returns unsubscribe function. */
  addHandler<P = unknown, R = unknown>(key: string, handler: IntentHandler<P, R>): () => void;
}
