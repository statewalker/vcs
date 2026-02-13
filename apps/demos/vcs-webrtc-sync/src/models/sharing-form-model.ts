import { BaseClass } from "../utils/index.js";

/**
 * Sharing form mode.
 */
export type SharingMode = "idle" | "share" | "connect";

/**
 * Model representing the sharing/signaling form state.
 * Tracks mode, local signal (offer/answer), and remote signal input.
 */
export class SharingFormModel extends BaseClass {
  #mode: SharingMode = "idle";
  #localSignal = "";
  #remoteSignal = "";
  #isProcessing = false;

  get mode(): SharingMode {
    return this.#mode;
  }

  get localSignal(): string {
    return this.#localSignal;
  }

  get remoteSignal(): string {
    return this.#remoteSignal;
  }

  get isProcessing(): boolean {
    return this.#isProcessing;
  }

  startShare(): void {
    this.#mode = "share";
    this.#localSignal = "";
    this.#remoteSignal = "";
    this.#isProcessing = true;
    this.notify();
  }

  startConnect(): void {
    this.#mode = "connect";
    this.#localSignal = "";
    this.#remoteSignal = "";
    this.#isProcessing = false;
    this.notify();
  }

  setLocalSignal(signal: string): void {
    this.#localSignal = signal;
    this.#isProcessing = false;
    this.notify();
  }

  setRemoteSignal(signal: string): void {
    if (this.#remoteSignal !== signal) {
      this.#remoteSignal = signal;
      this.notify();
    }
  }

  setProcessing(processing: boolean): void {
    if (this.#isProcessing !== processing) {
      this.#isProcessing = processing;
      this.notify();
    }
  }

  reset(): void {
    this.#mode = "idle";
    this.#localSignal = "";
    this.#remoteSignal = "";
    this.#isProcessing = false;
    this.notify();
  }
}
