/**
 * File-based WorkingCopyConfig implementation.
 *
 * Design:
 * - Per-worktree config in .git/worktrees/NAME/config (for additional worktrees)
 * - Main worktree uses .git/config section worktree.*
 * - Allows working-copy-specific settings
 */

import type { WorkingCopyConfig } from "@statewalker/vcs-core";

/**
 * Files API subset needed for config operations
 */
export interface ConfigFilesApi {
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, content: Uint8Array): Promise<void>;
}

/**
 * Git-compatible working copy configuration.
 *
 * Implements the WorkingCopyConfig interface with Git config file format support.
 */
export class GitWorkingCopyConfig implements WorkingCopyConfig {
  [key: string]: unknown;

  private readonly values: Map<string, unknown> = new Map();

  constructor(
    private readonly files: ConfigFilesApi,
    private readonly configPath: string,
  ) {}

  /**
   * Load configuration from file.
   */
  async load(): Promise<void> {
    const content = await this.files.read(this.configPath);
    if (!content) return;

    const text = new TextDecoder().decode(content);
    this.parseGitConfig(text);
  }

  /**
   * Save configuration to file.
   */
  async save(): Promise<void> {
    const content = this.serializeGitConfig();
    await this.files.write(this.configPath, new TextEncoder().encode(content));
  }

  /**
   * Get a configuration value.
   */
  get(key: string): unknown {
    return this.values.get(key.toLowerCase());
  }

  /**
   * Set a configuration value.
   */
  set(key: string, value: unknown): void {
    this.values.set(key.toLowerCase(), value);
    // Also set on the object itself for WorkingCopyConfig compatibility
    this[key] = value;
  }

  /**
   * Parse Git config file format.
   *
   * Format:
   * ```ini
   * [section]
   *     key = value
   * [section "subsection"]
   *     key = value
   * ```
   */
  private parseGitConfig(text: string): void {
    const lines = text.split(/\r?\n/);
    let currentSection = "";

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
        continue;
      }

      // Section header
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].toLowerCase().replace(/\s+/g, ".");
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([^=]+)\s*=\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim().toLowerCase();
        const value = this.parseValue(kvMatch[2].trim());
        const fullKey = currentSection ? `${currentSection}.${key}` : key;
        this.values.set(fullKey, value);
        this[fullKey] = value;
      }
    }
  }

  /**
   * Parse a config value (handles booleans and quoted strings).
   */
  private parseValue(value: string): unknown {
    // Boolean values
    const lower = value.toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "on") return true;
    if (lower === "false" || lower === "no" || lower === "off") return false;

    // Quoted string
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    // Number
    const num = Number(value);
    if (!Number.isNaN(num) && value !== "") return num;

    return value;
  }

  /**
   * Serialize config to Git format.
   */
  private serializeGitConfig(): string {
    const sections = new Map<string, Map<string, unknown>>();

    for (const [key, value] of this.values) {
      const lastDot = key.lastIndexOf(".");
      const sectionPart = lastDot >= 0 ? key.substring(0, lastDot) : "";
      const keyPart = lastDot >= 0 ? key.substring(lastDot + 1) : key;

      if (!sections.has(sectionPart)) {
        sections.set(sectionPart, new Map());
      }
      sections.get(sectionPart)?.set(keyPart, value);
    }

    const lines: string[] = [];
    for (const [section, values] of sections) {
      if (section) {
        // Format section header
        const sectionParts = section.split(".");
        if (sectionParts.length > 1) {
          lines.push(`[${sectionParts[0]} "${sectionParts.slice(1).join(".")}"]`);
        } else {
          lines.push(`[${section}]`);
        }
      }

      for (const [key, value] of values) {
        const serialized = this.serializeValue(value);
        lines.push(`\t${key} = ${serialized}`);
      }
    }

    return `${lines.join("\n")}\n`;
  }

  /**
   * Serialize a value for Git config format.
   */
  private serializeValue(value: unknown): string {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
      if (value.includes(" ") || value.includes('"')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }
    return String(value);
  }
}

/**
 * Create a WorkingCopyConfig instance.
 *
 * @param files File system API
 * @param gitDir Path to .git directory
 * @param worktreeName Name of worktree (for additional worktrees), undefined for main
 */
export async function createWorkingCopyConfig(
  files: ConfigFilesApi,
  gitDir: string,
  worktreeName?: string,
): Promise<GitWorkingCopyConfig> {
  const configPath = worktreeName
    ? `${gitDir}/worktrees/${worktreeName}/config`
    : `${gitDir}/config`;

  const config = new GitWorkingCopyConfig(files, configPath);
  await config.load();
  return config;
}
