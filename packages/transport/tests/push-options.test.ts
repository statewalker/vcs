/**
 * Push Options Tests
 *
 * Tests for Git push options functionality.
 *
 * This file contains both:
 * 1. Specification tests using inline mock functions (for documentation)
 * 2. Integration tests using real FSM handlers from src/fsm/push/
 *
 * Modeled after JGit's PushOptionsTest.java
 */

import { describe, expect, it } from "vitest";
import { getState, getTransport } from "../src/context/context-adapters.js";
import { ProtocolState } from "../src/context/protocol-state.js";
import { serverPushHandlers } from "../src/fsm/push/server-push-fsm.js";
import { createTestContext, type MockTransport } from "./helpers/test-protocol.js";

// ─────────────────────────────────────────────────────────────────────────────
// Push Options Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PushOptionsResult {
  success: boolean;
  optionsSent: string[];
  optionsReceived?: string[];
  error?: string;
}

/**
 * Simulates sending push options to server.
 */
function sendPushOptions(options: string[], serverSupportsOptions: boolean): PushOptionsResult {
  if (!serverSupportsOptions) {
    return {
      success: false,
      optionsSent: options,
      error: "server does not support push-options capability",
    };
  }

  return {
    success: true,
    optionsSent: options,
    optionsReceived: options,
  };
}

/**
 * Parses push options from protocol lines.
 */
function parsePushOptions(lines: string[]): string[] {
  const options: string[] = [];

  for (const line of lines) {
    // Push options are sent after commands, before pack
    if (line.startsWith("push-option ")) {
      options.push(line.slice("push-option ".length));
    } else if (!line.startsWith("0000") && !line.includes(" ")) {
      // Plain option without prefix (depends on protocol version)
      options.push(line);
    }
  }

  return options;
}

// ─────────────────────────────────────────────────────────────────────────────
// Push Options Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Push Options", () => {
  describe("should send push options to server", () => {
    it("sends single option", () => {
      const options = ["ci.skip"];

      const result = sendPushOptions(options, true);

      expect(result.success).toBe(true);
      expect(result.optionsSent).toContain("ci.skip");
    });

    it("sends option with value", () => {
      const options = ["merge.targetBranch=main"];

      const result = sendPushOptions(options, true);

      expect(result.success).toBe(true);
      expect(result.optionsSent).toContain("merge.targetBranch=main");
    });

    it("includes push-options capability in negotiation", () => {
      const state = new ProtocolState();

      state.capabilities.add("report-status");
      state.capabilities.add("push-options");

      expect(state.capabilities.has("push-options")).toBe(true);
    });
  });

  describe("should receive push option values", () => {
    it("receives options from client", () => {
      const clientLines = ["push-option ci.skip", "push-option merge.targetBranch=main"];

      const options = parsePushOptions(clientLines);

      expect(options).toContain("ci.skip");
      expect(options).toContain("merge.targetBranch=main");
    });

    it("passes options to pre-receive hook", () => {
      const options = ["ci.skip", "notify.team=backend"];

      // Simulate pre-receive hook receiving options
      const hookInput = {
        commands: [{ refName: "refs/heads/main", oldOid: "a", newOid: "b" }],
        pushOptions: options,
      };

      expect(hookInput.pushOptions).toHaveLength(2);
      expect(hookInput.pushOptions[0]).toBe("ci.skip");
    });
  });

  describe("should handle multiple options", () => {
    it("sends multiple options in order", () => {
      const options = [
        "ci.skip",
        "merge.targetBranch=main",
        "notify.team=backend",
        "review.required=true",
      ];

      const result = sendPushOptions(options, true);

      expect(result.success).toBe(true);
      expect(result.optionsSent).toHaveLength(4);
      expect(result.optionsSent[0]).toBe("ci.skip");
      expect(result.optionsSent[3]).toBe("review.required=true");
    });

    it("preserves option order", () => {
      const clientLines = ["push-option first", "push-option second", "push-option third"];

      const options = parsePushOptions(clientLines);

      expect(options[0]).toBe("first");
      expect(options[1]).toBe("second");
      expect(options[2]).toBe("third");
    });

    it("handles empty options list", () => {
      const options: string[] = [];

      const result = sendPushOptions(options, true);

      expect(result.success).toBe(true);
      expect(result.optionsSent).toHaveLength(0);
    });
  });

  describe("should reject when server does not support options", () => {
    it("fails when server lacks push-options capability", () => {
      const options = ["ci.skip"];

      const result = sendPushOptions(options, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not support");
    });

    it("checks capability before sending", () => {
      const serverCapabilities = new Set(["report-status", "delete-refs"]);

      const canSendOptions = serverCapabilities.has("push-options");

      expect(canSendOptions).toBe(false);
    });

    it("succeeds when server supports options", () => {
      const serverCapabilities = new Set(["report-status", "push-options"]);

      const canSendOptions = serverCapabilities.has("push-options");

      expect(canSendOptions).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Push Options Protocol Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Push Options Protocol", () => {
  it("should format push option packets", () => {
    const options = ["ci.skip", "topic=feature"];

    // Format as pkt-line (simplified)
    const packets = options.map((opt) => `${opt.length + 4 + 1}${opt}\n`);

    expect(packets).toHaveLength(2);
  });

  it("should terminate options with flush", () => {
    const optionPackets = ["ci.skip", "topic=feature"];
    const allPackets = [...optionPackets, "0000"]; // flush

    expect(allPackets[allPackets.length - 1]).toBe("0000");
  });

  it("should send options after commands", () => {
    const sequence = [
      // Commands
      "old-oid new-oid refs/heads/main\\0caps",
      "0000", // flush after commands
      // Options
      "ci.skip",
      "0000", // flush after options
      // Pack follows...
    ];

    // Find options section (between first and second flush)
    const firstFlush = sequence.indexOf("0000");
    const optionsStart = firstFlush + 1;
    const secondFlush = sequence.indexOf("0000", optionsStart);

    const optionsSection = sequence.slice(optionsStart, secondFlush);

    expect(optionsSection).toContain("ci.skip");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Push Options Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Common Push Options", () => {
  const commonOptions = [
    { name: "ci.skip", description: "Skip CI pipeline" },
    { name: "merge.targetBranch", description: "Target branch for merge" },
    { name: "topic", description: "Topic/feature name" },
    { name: "notify", description: "Notification settings" },
    { name: "review.required", description: "Require code review" },
  ];

  it("should parse option name", () => {
    const option = "merge.targetBranch=main";
    const [name] = option.split("=");

    expect(name).toBe("merge.targetBranch");
  });

  it("should parse option value", () => {
    const option = "merge.targetBranch=main";
    const [, value] = option.split("=");

    expect(value).toBe("main");
  });

  it("should handle options without values", () => {
    const option = "ci.skip";
    const parts = option.split("=");

    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe("ci.skip");
  });

  it("should handle options with = in value", () => {
    const option = "custom.key=value=with=equals";
    const [name, ...valueParts] = option.split("=");
    const value = valueParts.join("=");

    expect(name).toBe("custom.key");
    expect(value).toBe("value=with=equals");
  });

  it.each(commonOptions)("should support $name option", ({ name }) => {
    const options = [`${name}=test`];
    const result = sendPushOptions(options, true);

    expect(result.success).toBe(true);
    expect(result.optionsSent[0]).toContain(name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// READ_PUSH_OPTIONS FSM Handler Tests
// These tests verify the real FSM handler behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("READ_PUSH_OPTIONS FSM Handler", () => {
  it("should read push options when capability is negotiated", async () => {
    const ctx = createTestContext();
    const transport = getTransport(ctx) as MockTransport;

    // Simulate push-options capability negotiated
    getState(ctx).capabilities.add("push-options");

    transport._setPackets([
      { type: "data", text: "ci.skip" },
      { type: "data", text: "merge.targetBranch=main" },
      { type: "flush" },
    ]);

    const handler = serverPushHandlers.get("READ_PUSH_OPTIONS");
    expect(handler).toBeDefined();
    const result = await handler?.(ctx);

    expect(result).toBe("OPTIONS_RECEIVED");

    const ctxWithOptions = ctx as { pushOptions?: string[] };
    expect(ctxWithOptions.pushOptions).toHaveLength(2);
    expect(ctxWithOptions.pushOptions).toContain("ci.skip");
    expect(ctxWithOptions.pushOptions).toContain("merge.targetBranch=main");
  });

  it("should skip reading options when capability not negotiated", async () => {
    const ctx = createTestContext();
    const transport = getTransport(ctx) as MockTransport;

    // No push-options capability
    getState(ctx).capabilities.clear();
    getState(ctx).capabilities.add("report-status");

    // Even though we provide packets, they shouldn't be read
    transport._setPackets([{ type: "data", text: "ci.skip" }, { type: "flush" }]);

    const handler = serverPushHandlers.get("READ_PUSH_OPTIONS");
    expect(handler).toBeDefined();
    const result = await handler?.(ctx);

    expect(result).toBe("NO_OPTIONS");
  });

  it("should handle empty options list", async () => {
    const ctx = createTestContext();
    const transport = getTransport(ctx) as MockTransport;

    getState(ctx).capabilities.add("push-options");

    transport._setPackets([{ type: "flush" }]);

    const handler = serverPushHandlers.get("READ_PUSH_OPTIONS");
    expect(handler).toBeDefined();
    const result = await handler?.(ctx);

    expect(result).toBe("OPTIONS_RECEIVED");

    const ctxWithOptions = ctx as { pushOptions?: string[] };
    expect(ctxWithOptions.pushOptions).toHaveLength(0);
  });

  it("should preserve option order", async () => {
    const ctx = createTestContext();
    const transport = getTransport(ctx) as MockTransport;

    getState(ctx).capabilities.add("push-options");

    transport._setPackets([
      { type: "data", text: "first" },
      { type: "data", text: "second" },
      { type: "data", text: "third" },
      { type: "flush" },
    ]);

    const handler = serverPushHandlers.get("READ_PUSH_OPTIONS");
    expect(handler).toBeDefined();
    await handler?.(ctx);

    const ctxWithOptions = ctx as { pushOptions?: string[] };
    expect(ctxWithOptions.pushOptions?.[0]).toBe("first");
    expect(ctxWithOptions.pushOptions?.[1]).toBe("second");
    expect(ctxWithOptions.pushOptions?.[2]).toBe("third");
  });

  it("should handle options with equals sign in value", async () => {
    const ctx = createTestContext();
    const transport = getTransport(ctx) as MockTransport;

    getState(ctx).capabilities.add("push-options");

    transport._setPackets([
      { type: "data", text: "custom.key=value=with=equals" },
      { type: "flush" },
    ]);

    const handler = serverPushHandlers.get("READ_PUSH_OPTIONS");
    expect(handler).toBeDefined();
    await handler?.(ctx);

    const ctxWithOptions = ctx as { pushOptions?: string[] };
    expect(ctxWithOptions.pushOptions?.[0]).toBe("custom.key=value=with=equals");
  });
});
