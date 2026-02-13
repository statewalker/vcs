/**
 * Integration test for core package exports
 *
 * Verifies that all required types and functions are exported from @statewalker/vcs-core
 */

import { describe, expect, it } from "vitest";
import {
  createPersonIdent,
  createRef,
  createSymbolicRef,
  DeleteStagingEntry,
  FileMode,
  formatPersonIdent,
  GitBlobStore,
  GitCommitStore,
  GitObjectStoreImpl,
  GitTagStore,
  GitTreeStore,
  isSymbolicRef,
  // Raw storage
  MemoryRawStorage,
  MergeStage,
  // Object ID
  type ObjectId,
  // Object types
  ObjectType,
  // Format/Person
  type PersonIdent,
  parsePersonIdent,
  RefStorage,
  RefStoreLocation,
  UpdateStagingEntry,
} from "../src/index.js";

describe("Core exports", () => {
  describe("Raw storage", () => {
    it("exports MemoryRawStorage class", () => {
      expect(MemoryRawStorage).toBeDefined();
      expect(typeof MemoryRawStorage).toBe("function");
    });
  });

  describe("Object types", () => {
    it("exports ObjectType enum", () => {
      expect(ObjectType).toBeDefined();
      expect(ObjectType.COMMIT).toBe(1);
      expect(ObjectType.TREE).toBe(2);
      expect(ObjectType.BLOB).toBe(3);
      expect(ObjectType.TAG).toBe(4);
    });
  });

  describe("File modes", () => {
    it("exports FileMode enum", () => {
      expect(FileMode).toBeDefined();
      expect(FileMode.REGULAR_FILE).toBe(0o100644);
      expect(FileMode.EXECUTABLE_FILE).toBe(0o100755);
      expect(FileMode.TREE).toBe(0o040000);
      expect(FileMode.SYMLINK).toBe(0o120000);
      expect(FileMode.GITLINK).toBe(0o160000);
    });
  });

  describe("Refs", () => {
    it("exports RefStorage enum", () => {
      expect(RefStorage).toBeDefined();
      expect(RefStorage.LOOSE).toBe("loose");
      expect(RefStorage.PACKED).toBe("packed");
      expect(RefStorage.NEW).toBe("new");
    });

    it("exports RefStoreLocation as alias for RefStorage", () => {
      expect(RefStoreLocation).toBeDefined();
      expect(RefStoreLocation).toBe(RefStorage);
    });

    it("exports isSymbolicRef function", () => {
      expect(isSymbolicRef).toBeDefined();
      expect(typeof isSymbolicRef).toBe("function");

      const ref = createRef("refs/heads/main", "a".repeat(40) as ObjectId);
      const symRef = createSymbolicRef("HEAD", "refs/heads/main");

      expect(isSymbolicRef(ref)).toBe(false);
      expect(isSymbolicRef(symRef)).toBe(true);
    });

    it("exports createRef function", () => {
      expect(createRef).toBeDefined();
      const ref = createRef("refs/heads/main", "a".repeat(40) as ObjectId);
      expect(ref.name).toBe("refs/heads/main");
      expect(ref.storage).toBe(RefStorage.LOOSE);
    });

    it("exports createSymbolicRef function", () => {
      expect(createSymbolicRef).toBeDefined();
      const ref = createSymbolicRef("HEAD", "refs/heads/main");
      expect(ref.name).toBe("HEAD");
      expect(ref.target).toBe("refs/heads/main");
    });
  });

  describe("Person identity", () => {
    it("exports createPersonIdent function", () => {
      expect(createPersonIdent).toBeDefined();
      const ident = createPersonIdent("Test User", "test@example.com");
      expect(ident.name).toBe("Test User");
      expect(ident.email).toBe("test@example.com");
    });

    it("exports formatPersonIdent function", () => {
      expect(formatPersonIdent).toBeDefined();
      const ident: PersonIdent = {
        name: "Test User",
        email: "test@example.com",
        timestamp: 1234567890,
        tzOffset: "+0000",
      };
      const formatted = formatPersonIdent(ident);
      expect(formatted).toContain("Test User");
      expect(formatted).toContain("test@example.com");
    });

    it("exports parsePersonIdent function", () => {
      expect(parsePersonIdent).toBeDefined();
      const parsed = parsePersonIdent("Test User <test@example.com> 1234567890 +0000");
      expect(parsed.name).toBe("Test User");
      expect(parsed.email).toBe("test@example.com");
    });
  });

  describe("Staging", () => {
    it("exports MergeStage enum", () => {
      expect(MergeStage).toBeDefined();
      expect(MergeStage.MERGED).toBe(0);
      expect(MergeStage.BASE).toBe(1);
      expect(MergeStage.OURS).toBe(2);
      expect(MergeStage.THEIRS).toBe(3);
    });

    it("exports UpdateStagingEntry class", () => {
      expect(UpdateStagingEntry).toBeDefined();
      expect(typeof UpdateStagingEntry).toBe("function");
    });

    it("exports DeleteStagingEntry class", () => {
      expect(DeleteStagingEntry).toBeDefined();
      expect(typeof DeleteStagingEntry).toBe("function");
    });
  });

  describe("Store implementations", () => {
    it("exports GitBlobStore class", () => {
      expect(GitBlobStore).toBeDefined();
      expect(typeof GitBlobStore).toBe("function");
    });

    it("exports GitCommitStore class", () => {
      expect(GitCommitStore).toBeDefined();
      expect(typeof GitCommitStore).toBe("function");
    });

    it("exports GitTreeStore class", () => {
      expect(GitTreeStore).toBeDefined();
      expect(typeof GitTreeStore).toBe("function");
    });

    it("exports GitTagStore class", () => {
      expect(GitTagStore).toBeDefined();
      expect(typeof GitTagStore).toBe("function");
    });

    it("exports GitObjectStoreImpl class", () => {
      expect(GitObjectStoreImpl).toBeDefined();
      expect(typeof GitObjectStoreImpl).toBe("function");
    });
  });
});
