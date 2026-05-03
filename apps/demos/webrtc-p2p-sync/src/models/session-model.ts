/**
 * Session state model.
 *
 * Tracks the current connection mode, session ID, shareable URL,
 * QR code data, and any errors.
 */

import { Base, newAdapter } from "../utils/index.js";

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
export class SessionModel extends Base {
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
    return this.update(() => {
      this.state.mode = mode;
    
    });
  }

  /**
   * Set the session ID.
   */
  setSessionId(id: string | null): void {
    return this.update(() => {
      this.state.sessionId = id;
    
    });
  }

  /**
   * Set the shareable URL.
   */
  setShareUrl(url: string | null): void {
    return this.update(() => {
      this.state.shareUrl = url;
    
    });
  }

  /**
   * Set the QR code data URL.
   */
  setQrCodeDataUrl(dataUrl: string | null): void {
    return this.update(() => {
      this.state.qrCodeDataUrl = dataUrl;
    
    });
  }

  /**
   * Set the join input field value.
   */
  setJoinInputValue(value: string): void {
    return this.update(() => {
      this.state.joinInputValue = value;
    
    });
  }

  /**
   * Set the error message.
   */
  setError(error: string | null): void {
    return this.update(() => {
      this.state.error = error;
    
    });
  }

  /**
   * Update multiple fields at once (single notification).
   */
  update(partial: Partial<SessionState>): void {
    return this.update(() => {
      Object.assign(this.state, partial);
    
    });
  }

  /**
   * Reset to disconnected state.
   */
  reset(): void {
    return this.update(() => {
      this.state = {
        mode: "disconnected",
        sessionId: null,
        shareUrl: null,
        qrCodeDataUrl: null,
        joinInputValue: this.state.joinInputValue, // Keep input value
        error: null,
      };
    
    });
  }
}

/**
 * Context adapter for SessionModel.
 */
export const [getSessionModel, setSessionModel] = newAdapter<SessionModel>(
  "session-model",
  () => new SessionModel(),
);
