# Versioned Documents Demo

Document versioning in the browser using Git-like storage. Upload DOCX or ODF files and track changes over time.

## Features

- Upload DOCX/ODF documents via drag-and-drop or file picker
- View internal document structure (XML components, media files)
- Save versions with descriptive messages
- View version history with timestamps
- Restore previous versions
- Download any version as a reconstructed document
- Compare versions to see what changed

## Quick Start

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev
```

Then open http://localhost:5173 in your browser.

## How It Works

### Document Decomposition

DOCX and ODF files are ZIP archives containing:
- XML files (content, styles, metadata)
- Media files (images, embedded objects)
- Relationship files

This demo uses JSZip to decompose documents into their component files.

```typescript
const components = await decomposeDocument(file);
// components.files is Map<string, Uint8Array>
// components.metadata has type, fileName, fileCount
```

### Version Storage

Each version is stored as a Git commit:
1. Component files become blobs (content-addressable)
2. Blobs are organized into a tree
3. Tree is referenced by a commit
4. Commit contains message, author, timestamp

```typescript
const tracker = await createVersionTracker();
const versionId = await tracker.saveVersion(components, "Updated chapter 3");
```

### Document Reconstruction

To restore a version:
1. Load the commit's tree
2. Collect all blob contents
3. Reassemble into a ZIP archive

```typescript
const components = await tracker.getVersion(versionId);
const blob = await reconstructDocument(components, "document.docx");
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Browser Application                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐    ┌───────────────┐                        │
│  │   Document    │───▶│   Decomposer  │                        │
│  │   (DOCX)      │    │   (JSZip)     │                        │
│  └───────────────┘    └───────┬───────┘                        │
│                               │                                 │
│                               ▼                                 │
│                    ┌─────────────────────┐                      │
│                    │   VCS Repository    │                      │
│                    │   (In-Memory)       │                      │
│                    │                     │                      │
│                    │   /word/document.xml│                      │
│                    │   /word/styles.xml  │                      │
│                    │   /word/media/...   │                      │
│                    └─────────────────────┘                      │
│                               │                                 │
│                               ▼                                 │
│                    ┌─────────────────────┐                      │
│                    │   History View      │                      │
│                    │   Version Compare   │                      │
│                    │   Restore Version   │                      │
│                    └─────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

## API Reference

### DocumentComponents

```typescript
interface DocumentComponents {
  files: Map<string, Uint8Array>;
  metadata: {
    type: "docx" | "odf" | "unknown";
    fileName: string;
    fileCount: number;
  };
}
```

### VersionTracker

```typescript
class VersionTracker {
  // Initialize repository
  async initialize(): Promise<void>;

  // Save a new version
  async saveVersion(
    components: Map<string, Uint8Array>,
    message: string
  ): Promise<string>;

  // Get version contents
  async getVersion(versionId: string): Promise<Map<string, Uint8Array>>;

  // List all versions
  async listVersions(): Promise<VersionInfo[]>;

  // Compare two versions
  async compareVersions(
    fromId: string,
    toId: string
  ): Promise<Array<{ path: string; type: "added" | "removed" | "modified" }>>;
}
```

## Use Cases

1. **Document Collaboration**: Track who changed what and when
2. **Backup and Recovery**: Never lose previous versions
3. **Audit Trail**: Required for compliance in some industries
4. **Experimentation**: Try changes without fear of losing work

## Browser Support

- Chrome 86+ (full support)
- Firefox 90+ (full support)
- Safari 15+ (full support)
- Edge 86+ (full support)

## Limitations

- Storage is in-memory only (lost on page refresh)
- Large documents may impact performance
- No real-time collaboration (single user)

## Future Enhancements

- Persistent storage using IndexedDB or File System Access API
- Content-level diff (show actual text changes)
- Branch support for parallel edits
- Export version history
