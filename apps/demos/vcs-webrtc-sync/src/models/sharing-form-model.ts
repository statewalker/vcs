import { Base } from "../utils/index.js";

/**
 * Sharing form mode.
 */
export type SharingMode = "idle" | "share" | "connect";

/**
 * Model representing the sharing/signaling form state.
 * Tracks mode, local signal (offer/answer), and remote signal input.
 */
export class SharingFormModel extends Base {
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
    return this.update(() => {
      this.#mode = "share";
      this.#localSignal = "";
      this.#remoteSignal = "";
      this.#isProcessing = true;
    
    });
  }

  startConnect(): void {
    return this.update(() => {
      this.#mode = "connect";
      this.#localSignal = "";
      this.#remoteSignal = "";
      this.#isProcessing = false;
    
    });
  }

  setLocalSignal(signal: string): void {
    return this.update(() => {
      this.#localSignal = signal;
      this.#isProcessing = false;
    
    });
  }

  setRemoteSignal(signal: string): void {
    if (this.#remoteSignal !== signal) {
      return this.update(() => {
        this.#remoteSignal = signal;
      
      });
    }
  }

  setProcessing(processing: boolean): void {
    if (this.#isProcessing !== processing) {
      return this.update(() => {
        this.#isProcessing = processing;
      
      });
    }
  }

  reset(): void {
    return this.update(() => {
      this.#mode = "idle";
      this.#localSignal = "";
      this.#remoteSignal = "";
      this.#isProcessing = false;
    
    });
  }
}
