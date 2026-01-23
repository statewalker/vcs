/**
 * Test Helpers for Transport Package
 *
 * Provides test infrastructure for Git transport protocol testing.
 * Modeled after JGit's test utilities.
 */

// Test Repository Helper
export {
  TestRepository,
  createTestRepository,
  createInitializedRepository,
  createComplexRepository,
  type StoredObject,
  type TestCommit,
  type TreeEntry,
  type TestTag,
  type ObjectType,
} from "./test-repository.js";

// Test Protocol Helper
export {
  createMockTransport,
  createMockRefStore,
  createMockRepository,
  createTestContext,
  runProtocolScenario,
  packets,
  PacketSequenceBuilder,
  ProtocolMessages,
  verifyPackets,
  randomOid,
  testOid,
  type MockTransport,
  type MockRefStore,
  type PktLineResult,
  type SidebandResult,
  type ProtocolScenario,
} from "./test-protocol.js";

// Test HTTP Server Helper
export {
  TestHttpServer,
  createTestHttpServer,
  createInitializedHttpServer,
  type AuthConfig,
  type RedirectConfig,
  type DelayConfig,
  type CapturedRequest,
  type CapturedResponse,
  type CapturedExchange,
  type TestHttpServerConfig,
} from "./test-http-server.js";
