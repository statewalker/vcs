/**
 * Entry types for streaming Git object serialization
 *
 * These entry types enable streaming serialization of commits and tags.
 * Each field becomes a separate entry that can be processed incrementally.
 */

import type { ObjectTypeCode, PersonIdent } from "../object-storage/interfaces/index.js";

/**
 * Commit entry for streaming serialization
 *
 * A commit is serialized as a sequence of entries:
 * - tree (exactly one)
 * - parent (zero or more)
 * - author (exactly one)
 * - committer (exactly one)
 * - encoding (optional)
 * - gpgsig (optional)
 * - message (exactly one)
 */
export type CommitEntry =
  | { type: "tree"; value: string }
  | { type: "parent"; value: string }
  | { type: "author"; value: PersonIdent }
  | { type: "committer"; value: PersonIdent }
  | { type: "encoding"; value: string }
  | { type: "gpgsig"; value: string }
  | { type: "message"; value: string };

/**
 * Tag entry for streaming serialization
 *
 * A tag is serialized as a sequence of entries:
 * - object (exactly one)
 * - objectType (exactly one)
 * - tag (exactly one)
 * - tagger (optional)
 * - encoding (optional)
 * - gpgsig (optional)
 * - message (exactly one)
 */
export type TagEntry =
  | { type: "object"; value: string }
  | { type: "objectType"; value: ObjectTypeCode }
  | { type: "tag"; value: string }
  | { type: "tagger"; value: PersonIdent }
  | { type: "encoding"; value: string }
  | { type: "gpgsig"; value: string }
  | { type: "message"; value: string };
