import { createInMemoryFilesApi, type FilesApi } from "../../../src/common/files/index.js";
import { FileRawStorage } from "../../../src/storage/raw/index.js";
import { rawStorageConformanceTests } from "./raw-storage.conformance.test.js";

let files: FilesApi;

rawStorageConformanceTests(
  "FileRawStorage",
  async () => {
    files = createInMemoryFilesApi();
    return new FileRawStorage(files, "/objects");
  },
  async () => {
    // createInMemoryFilesApi cleanup is automatic (new instance each test)
  },
);
