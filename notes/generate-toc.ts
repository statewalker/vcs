#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

interface Page {
  name: string;
  path: string;
  open?: boolean;
  pages?: Page[];
}

interface FileInfo {
  filePath: string;
  title: string;
  urlPath: string;
  isIndex: boolean;
  depth: number;
}

const DEFAULT_SRC_DIR = "./src";

/**
 * Extract the first header (# or ##) from a markdown file
 */
function extractTitle(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(/^#\s+(.+)$/);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return null;
  }
}

/**
 * Recursively find all markdown files in a directory
 */
function findMarkdownFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    // Skip .observablehq directories and other hidden directories
    if (stat.isDirectory() && !entry.startsWith(".")) {
      findMarkdownFiles(fullPath, files);
    } else if (stat.isFile() && entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Convert file path to URL path
 * - Remove .md extension
 * - For index.md files, use the directory path ending with /
 * - For other files, use the file path without extension
 */
function toUrlPath(filePath: string, rootDir: string): string {
  const rel = relative(rootDir, filePath);
  const isIndex = basename(rel) === "index.md";

  if (isIndex) {
    const dir = dirname(rel);
    return dir === "." ? "/" : `/${dir}/`;
  }
  // Remove .md extension
  const withoutExt = rel.replace(/\.md$/, "");
  return `/${withoutExt}`;
}

/**
 * Get the depth of a file path (number of directories deep)
 */
function getDepth(filePath: string, rootDir: string): number {
  const rel = relative(rootDir, filePath);
  if (rel === "." || rel === "index.md") return 0;
  return rel.split("/").length - 1;
}

/**
 * Get the top-level directory for a file, or null if it's in the root
 */
function getTopLevelDir(filePath: string, rootDir: string): string | null {
  const rel = relative(rootDir, filePath);
  const parts = rel.split("/");

  // If file is in root (no directories)
  if (parts.length === 1) return null;

  // Return first directory
  return parts[0];
}

/**
 * Build the TOC structure for a given root directory
 * @param rootDir - The root directory containing markdown files (default: "./src")
 * @returns Array of pages in ObservableHQ format
 */
export function buildTOC(rootDir = "./src"): Page[] {
  const markdownFiles = findMarkdownFiles(rootDir);

  // Extract file info
  const fileInfos: FileInfo[] = markdownFiles
    .map((filePath) => {
      const title = extractTitle(filePath);
      if (!title) {
        console.warn(`No title found in ${filePath}, skipping`);
        return null;
      }

      return {
        filePath,
        title,
        urlPath: toUrlPath(filePath, rootDir),
        isIndex: basename(filePath) === "index.md",
        depth: getDepth(filePath, rootDir),
      };
    })
    .filter((info): info is FileInfo => info !== null)
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath));

  // Group by top-level directory
  const grouped = new Map<string | null, FileInfo[]>();

  for (const info of fileInfos) {
    const topDir = getTopLevelDir(info.filePath, rootDir);
    if (!grouped.has(topDir)) {
      grouped.set(topDir, []);
    }
    grouped.get(topDir)?.push(info);
  }

  const pages: Page[] = [];

  // Process each top-level group
  for (const [topDir, infos] of Array.from(grouped.entries()).sort((a, b) => {
    // Sort: null (root files) first, then alphabetically
    if (a[0] === null) return -1;
    if (b[0] === null) return 1;
    return a[0].localeCompare(b[0]);
  })) {
    if (topDir === null) {
      // Root level files - add them directly to pages (no section)
      for (const info of infos) {
        if (!info.isIndex) {
          pages.push({
            name: info.title,
            path: info.urlPath,
            open: false,
          });
        }
      }
    } else {
      // This is a top-level directory - create a section
      let indexFile = infos.find((info) => info.isIndex && getDepth(info.filePath, rootDir) === 1);

      // If no index.md, use the first file alphabetically as the section header
      if (!indexFile) {
        console.warn(
          `No index.md found for directory ${topDir}, using first file as section header`,
        );
        const sortedInfos = [...infos].sort((a, b) =>
          basename(a.filePath).localeCompare(basename(b.filePath)),
        );
        indexFile = sortedInfos[0];

        if (!indexFile) {
          console.warn(`No files found in directory ${topDir}, skipping section`);
          continue;
        }
      }

      // Create section with all nested files flattened
      const sectionPages: Page[] = infos
        .filter((info) => info !== indexFile) // Exclude the index file itself
        .map((info) => ({
          name: info.title,
          path: info.urlPath,
        }));

      pages.push({
        name: indexFile.title,
        path: indexFile.urlPath,
        open: false,
        ...(sectionPages.length > 0 ? { pages: sectionPages } : {}),
      });
    }
  }

  return pages;
}

/**
 * Format the pages array as JavaScript code
 */
function formatPages(pages: Page[], indent = 2): string {
  const indentStr = " ".repeat(indent);
  const lines: string[] = [];

  lines.push("[");

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isLast = i === pages.length - 1;

    lines.push(`${indentStr}{`);
    lines.push(`${indentStr}  name: "${page.name}",`);
    lines.push(`${indentStr}  path: "${page.path}",`);

    if (page.open !== undefined) {
      lines.push(`${indentStr}  open: ${page.open}${page.pages ? "," : ""}`);
    }

    if (page.pages) {
      const nestedPages = formatPages(page.pages, indent + 4);
      lines.push(`${indentStr}  pages: ${nestedPages}`);
    }

    lines.push(`${indentStr}}${isLast ? "" : ","}`);
  }

  lines.push(`${" ".repeat(indent - 2)}]`);

  return lines.join("\n");
}

// Main execution (when run directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const toc = buildTOC(process.argv[2] || DEFAULT_SRC_DIR);
  const formatted = formatPages(toc);

  console.log("Generated TOC:");
  console.log("--------------------------------");
  console.log(formatted); // Remove leading '['
  console.log("--------------------------------");
  console.log("Copy this to your observablehq.config.js file");
}
