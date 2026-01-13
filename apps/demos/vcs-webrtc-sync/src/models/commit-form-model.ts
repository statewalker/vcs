import { BaseClass } from "../utils/index.js";

/**
 * Model representing the commit form state.
 * Tracks commit message input and committing state.
 */
export class CommitFormModel extends BaseClass {
  #message = "";
  #isCommitting = false;

  get message(): string {
    return this.#message;
  }

  get isCommitting(): boolean {
    return this.#isCommitting;
  }

  get canCommit(): boolean {
    return this.#message.trim().length > 0 && !this.#isCommitting;
  }

  setMessage(message: string): void {
    if (this.#message !== message) {
      this.#message = message;
      this.notify();
    }
  }

  setCommitting(isCommitting: boolean): void {
    if (this.#isCommitting !== isCommitting) {
      this.#isCommitting = isCommitting;
      this.notify();
    }
  }

  clear(): void {
    const hadContent = this.#message !== "" || this.#isCommitting;
    this.#message = "";
    this.#isCommitting = false;
    if (hadContent) {
      this.notify();
    }
  }
}
