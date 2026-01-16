/**
 * Session state model.
 *
 * Tracks the current connection mode, session ID, shareable URL,
 * QR code data, and any errors.
 */

import { BaseClass, newAdapter } from "../utils/index.js";

/**
 * Current session connection mode.
 */
export type SessionMode = "disconnected" | "hosting" | "joined";

/**
 * Complete session state.
 */
export interface SessionState {
  /** Current connection mode. */
  mode: SessionMode;
  /** Session ID when hosting or joined. */
  sessionId: string | null;
  /** Shareable URL for hosting mode. */
  shareUrl: string | null;
  /** QR code image as data URL for hosting mode. */
  qrCodeDataUrl: string | null;
  /** Value in the join input field (pre-filled from URL or user input). */
  joinInputValue: string;
  /** Error message if something went wrong. */
  error: string | null;
}

/**
 * Session model - tracks connection state and session info.
 *
 * This model holds NO business logic. Controllers react to state changes
 * and perform actual PeerJS operations.
 */
export class SessionModel extends BaseClass {
  private state: SessionState = {
    mode: "disconnected",
    sessionId: null,
    shareUrl: null,
    qrCodeDataUrl: null,
    joinInputValue: "",
    error: null,
  };

  /**
   * Get the current state (readonly).
   */
  getState(): Readonly<SessionState> {
    return this.state;
  }

  /**
   * Set the connection mode.
   */
  setMode(mode: SessionMode): void {
    this.state.mode = mode;
    this.notify();
  }

  /**
   * Set the session ID.
   */
  setSessionId(id: string | null): void {
    this.state.sessionId = id;
    this.notify();
  }

  /**
   * Set the shareable URL.
   */
  setShareUrl(url: string | null): void {
    this.state.shareUrl = url;
    this.notify();
  }

  /**
   * Set the QR code data URL.
   */
  setQrCodeDataUrl(dataUrl: string | null): void {
    this.state.qrCodeDataUrl = dataUrl;
    this.notify();
  }

  /**
   * Set the join input field value.
   */
  setJoinInputValue(value: string): void {
    this.state.joinInputValue = value;
    this.notify();
  }

  /**
   * Set the error message.
   */
  setError(error: string | null): void {
    this.state.error = error;
    this.notify();
  }

  /**
   * Update multiple fields at once (single notification).
   */
  update(partial: Partial<SessionState>): void {
    Object.assign(this.state, partial);
    this.notify();
  }

  /**
   * Reset to disconnected state.
   */
  reset(): void {
    this.state = {
      mode: "disconnected",
      sessionId: null,
      shareUrl: null,
      qrCodeDataUrl: null,
      joinInputValue: this.state.joinInputValue, // Keep input value
      error: null,
    };
    this.notify();
  }
}

/**
 * Context adapter for SessionModel.
 */
export const [getSessionModel, setSessionModel] = newAdapter<SessionModel>(
  "session-model",
  () => new SessionModel(),
);
