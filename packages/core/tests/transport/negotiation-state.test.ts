/**
 * Tests for Multi-ACK negotiation state machine.
 * Ported from JGit's UploadPackTest.java negotiation tests.
 */

import { describe, expect, it } from "vitest";
import {
  canGiveUp,
  createNegotiationState,
  determineMultiAckMode,
  generateAckResponse,
  generateFinalResponse,
  generateReadyResponse,
  type HaveProcessResult,
} from "../../src/transport/handlers/negotiation-state.js";

// Sample object IDs for testing
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const COMMIT_C = "c".repeat(40);
const COMMIT_D = "d".repeat(40);

describe("NegotiationState", () => {
  describe("determineMultiAckMode", () => {
    it("should return off when no multi_ack capability", () => {
      const capabilities = new Set<string>(["side-band-64k", "ofs-delta"]);
      expect(determineMultiAckMode(capabilities)).toBe("off");
    });

    it("should return continue when multi_ack capability present", () => {
      const capabilities = new Set<string>(["multi_ack"]);
      expect(determineMultiAckMode(capabilities)).toBe("continue");
    });

    it("should return detailed when multi_ack_detailed capability present", () => {
      const capabilities = new Set<string>(["multi_ack_detailed"]);
      expect(determineMultiAckMode(capabilities)).toBe("detailed");
    });

    it("should prefer detailed over continue when both present", () => {
      const capabilities = new Set<string>(["multi_ack", "multi_ack_detailed"]);
      expect(determineMultiAckMode(capabilities)).toBe("detailed");
    });
  });

  describe("createNegotiationState", () => {
    it("should create initial state with correct defaults", () => {
      const state = createNegotiationState();
      expect(state.commonBases.size).toBe(0);
      expect(state.peerHas.size).toBe(0);
      expect(state.sentReady).toBe(false);
      expect(state.noDone).toBe(false);
      expect(state.multiAckMode).toBe("off");
      expect(state.lastObjectId).toBeNull();
    });
  });

  describe("generateAckResponse", () => {
    it("should return null when object not found", () => {
      const state = createNegotiationState();
      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: false,
        isNewCommonBase: false,
      };
      expect(generateAckResponse(result, state)).toBeNull();
    });

    it("should return null when not a new common base", () => {
      const state = createNegotiationState();
      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: false,
      };
      expect(generateAckResponse(result, state)).toBeNull();
    });

    it("should generate simple ACK for off mode on first common base", () => {
      const state = createNegotiationState();
      state.multiAckMode = "off";
      state.commonBases.add(COMMIT_A); // First common base

      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: true,
      };
      expect(generateAckResponse(result, state)).toBe(`ACK ${COMMIT_A}\n`);
    });

    it("should return null for off mode on subsequent common bases", () => {
      const state = createNegotiationState();
      state.multiAckMode = "off";
      state.commonBases.add(COMMIT_A);
      state.commonBases.add(COMMIT_B); // Already have 2

      const result: HaveProcessResult = {
        objectId: COMMIT_B,
        hasObject: true,
        isNewCommonBase: true,
      };
      expect(generateAckResponse(result, state)).toBeNull();
    });

    it("should generate ACK with continue for continue mode", () => {
      const state = createNegotiationState();
      state.multiAckMode = "continue";

      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: true,
      };
      expect(generateAckResponse(result, state)).toBe(`ACK ${COMMIT_A} continue\n`);
    });

    it("should generate ACK common for detailed mode", () => {
      const state = createNegotiationState();
      state.multiAckMode = "detailed";

      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: true,
      };
      expect(generateAckResponse(result, state)).toBe(`ACK ${COMMIT_A} common\n`);
    });
  });

  describe("generateReadyResponse", () => {
    it("should generate ACK ready for detailed mode", () => {
      const state = createNegotiationState();
      state.multiAckMode = "detailed";
      const response = generateReadyResponse(COMMIT_A, state);
      expect(response).toBe(`ACK ${COMMIT_A} ready\n`);
    });

    it("should generate ACK continue for continue mode", () => {
      const state = createNegotiationState();
      state.multiAckMode = "continue";
      const response = generateReadyResponse(COMMIT_A, state);
      expect(response).toBe(`ACK ${COMMIT_A} continue\n`);
    });

    it("should return null for off mode", () => {
      const state = createNegotiationState();
      state.multiAckMode = "off";
      const response = generateReadyResponse(COMMIT_A, state);
      expect(response).toBeNull();
    });
  });

  describe("generateFinalResponse", () => {
    it("should return NAK when no common bases", () => {
      const state = createNegotiationState();
      expect(generateFinalResponse(state)).toBe("NAK\n");
    });

    it("should return ACK for last object in multi-ack mode", () => {
      const state = createNegotiationState();
      state.multiAckMode = "continue";
      state.commonBases.add(COMMIT_A);
      state.lastObjectId = COMMIT_A;
      expect(generateFinalResponse(state)).toBe(`ACK ${COMMIT_A}\n`);
    });

    it("should return NAK for off mode even with common bases", () => {
      const state = createNegotiationState();
      state.multiAckMode = "off";
      state.commonBases.add(COMMIT_A);
      expect(generateFinalResponse(state)).toBe("NAK\n");
    });
  });

  describe("canGiveUp", () => {
    it("should return false when no common bases", () => {
      const state = createNegotiationState();
      expect(canGiveUp(state, 1)).toBe(false);
    });

    it("should return true when has common bases", () => {
      const state = createNegotiationState();
      state.commonBases.add(COMMIT_A);
      expect(canGiveUp(state, 1)).toBe(true);
    });
  });
});

describe("Multi-ACK Negotiation Scenarios", () => {
  describe("Simple negotiation (mode off)", () => {
    it("should handle single have that matches", () => {
      const state = createNegotiationState();
      state.multiAckMode = "off";

      // Client sends "have COMMIT_A", server has it
      state.commonBases.add(COMMIT_A);

      expect(state.commonBases.has(COMMIT_A)).toBe(true);
      expect(canGiveUp(state, 1)).toBe(true);
    });

    it("should handle multiple haves", () => {
      const state = createNegotiationState();

      // Server matches multiple client commits
      state.commonBases.add(COMMIT_A);
      state.commonBases.add(COMMIT_B);

      expect(state.commonBases.size).toBe(2);
    });
  });

  describe("Continue negotiation (mode continue)", () => {
    it("should generate continue ACKs for common commits", () => {
      const state = createNegotiationState();
      state.multiAckMode = "continue";

      // First common commit
      const result1: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: true,
      };
      const ack1 = generateAckResponse(result1, state);
      expect(ack1).toBe(`ACK ${COMMIT_A} continue\n`);

      // Second common commit
      const result2: HaveProcessResult = {
        objectId: COMMIT_B,
        hasObject: true,
        isNewCommonBase: true,
      };
      const ack2 = generateAckResponse(result2, state);
      expect(ack2).toBe(`ACK ${COMMIT_B} continue\n`);
    });
  });

  describe("Detailed negotiation (mode detailed)", () => {
    it("should generate common ACKs for new common commits", () => {
      const state = createNegotiationState();
      state.multiAckMode = "detailed";

      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: true,
      };
      const ack = generateAckResponse(result, state);
      expect(ack).toBe(`ACK ${COMMIT_A} common\n`);
    });

    it("should not ACK when not new common base", () => {
      const state = createNegotiationState();
      state.multiAckMode = "detailed";
      state.commonBases.add(COMMIT_A);

      // Sending same commit again is not a new common base
      const result: HaveProcessResult = {
        objectId: COMMIT_A,
        hasObject: true,
        isNewCommonBase: false,
      };
      const ack = generateAckResponse(result, state);
      expect(ack).toBeNull();
    });

    it("should generate ready when all wants are reachable", () => {
      const state = createNegotiationState();
      state.multiAckMode = "detailed";
      state.commonBases.add(COMMIT_A);
      state.commonBases.add(COMMIT_B);

      const ready = generateReadyResponse(COMMIT_B, state);
      expect(ready).toBe(`ACK ${COMMIT_B} ready\n`);
    });
  });
});

describe("Negotiation edge cases", () => {
  it("should handle empty have list", () => {
    const state = createNegotiationState();
    expect(state.commonBases.size).toBe(0);
    expect(canGiveUp(state, 1)).toBe(false);
  });

  it("should track multiple common bases", () => {
    const state = createNegotiationState();

    state.commonBases.add(COMMIT_A);
    state.commonBases.add(COMMIT_B);
    state.commonBases.add(COMMIT_C);
    state.commonBases.add(COMMIT_D);

    expect(state.commonBases.size).toBe(4);
    expect(state.commonBases.has(COMMIT_A)).toBe(true);
    expect(state.commonBases.has(COMMIT_B)).toBe(true);
    expect(state.commonBases.has(COMMIT_C)).toBe(true);
    expect(state.commonBases.has(COMMIT_D)).toBe(true);
  });

  it("should track peer has separately from common bases", () => {
    const state = createNegotiationState();

    state.commonBases.add(COMMIT_A);
    state.peerHas.add(COMMIT_B);

    expect(state.commonBases.has(COMMIT_A)).toBe(true);
    expect(state.commonBases.has(COMMIT_B)).toBe(false);
    expect(state.peerHas.has(COMMIT_B)).toBe(true);
    expect(state.peerHas.has(COMMIT_A)).toBe(false);
  });
});
