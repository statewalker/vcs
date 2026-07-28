/**
 * Self-contained line-based three-way merge.
 *
 * Splitting on "\n" and re-joining on "\n" is an exact inverse (a trailing
 * newline shows up as a trailing empty element), so line arrays round-trip the
 * original text byte-for-byte.
 */

interface Edit {
  /** Replaced range in base: [beginA, endA). */
  beginA: number;
  endA: number;
  /** Replacement range in the side: [beginB, endB). */
  beginB: number;
  endB: number;
}

/** Longest-common-subsequence anchors as (baseIndex, sideIndex) pairs. */
function lcsMatches(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** Turn the LCS anchors into a list of replace edits base→side. */
function diffEdits(base: readonly string[], side: readonly string[]): Edit[] {
  const matches = lcsMatches(base, side);
  const edits: Edit[] = [];
  let a = 0;
  let b = 0;
  for (const [ma, mb] of matches) {
    if (ma > a || mb > b) edits.push({ beginA: a, endA: ma, beginB: b, endB: mb });
    a = ma + 1;
    b = mb + 1;
  }
  if (a < base.length || b < side.length) {
    edits.push({ beginA: a, endA: base.length, beginB: b, endB: side.length });
  }
  return edits;
}

/** Do two base ranges touch? Point insertions collide only at the same index. */
function editsOverlap(e1: Edit, e2: Edit): boolean {
  if (e1.beginA === e1.endA && e2.beginA === e2.endA) return e1.beginA === e2.beginA;
  if (e1.beginA === e1.endA) return e1.beginA >= e2.beginA && e1.beginA <= e2.endA;
  if (e2.beginA === e2.endA) return e2.beginA >= e1.beginA && e2.beginA <= e1.endA;
  return e1.beginA < e2.endA && e2.beginA < e1.endA;
}

function slicesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface ThreeWayResult {
  ok: boolean;
  /** Merged lines, present only when `ok`. */
  lines?: string[];
}

/**
 * Diff3 combine: walk base, taking non-overlapping edits from either side and
 * flagging overlapping edits as a conflict unless both sides made the identical
 * change.
 */
export function threeWayMergeLines(
  base: readonly string[],
  left: readonly string[],
  right: readonly string[],
): ThreeWayResult {
  const leftEdits = diffEdits(base, left);
  const rightEdits = diffEdits(base, right);

  const out: string[] = [];
  let basePtr = 0;
  let li = 0;
  let ri = 0;

  while (basePtr < base.length || li < leftEdits.length || ri < rightEdits.length) {
    const le = li < leftEdits.length ? leftEdits[li] : null;
    const re = ri < rightEdits.length ? rightEdits[ri] : null;

    const nextLeft = le ? le.beginA : base.length;
    const nextRight = re ? re.beginA : base.length;
    const nextBase = Math.min(nextLeft, nextRight);

    // Emit the unchanged run leading up to the next edit.
    if (basePtr < nextBase) {
      for (let k = basePtr; k < nextBase; k++) out.push(base[k]);
      basePtr = nextBase;
      continue;
    }

    if (le && re && editsOverlap(le, re)) {
      const leftRepl = left.slice(le.beginB, le.endB);
      const rightRepl = right.slice(re.beginB, re.endB);
      const sameBase = le.beginA === re.beginA && le.endA === re.endA;
      if (sameBase && slicesEqual(leftRepl, rightRepl)) {
        for (const l of leftRepl) out.push(l);
        basePtr = Math.max(le.endA, re.endA);
        li++;
        ri++;
        continue;
      }
      return { ok: false };
    }

    if (le && (!re || le.beginA <= re.beginA)) {
      for (let k = le.beginB; k < le.endB; k++) out.push(left[k]);
      basePtr = le.endA;
      li++;
    } else if (re) {
      for (let k = re.beginB; k < re.endB; k++) out.push(right[k]);
      basePtr = re.endA;
      ri++;
    }
  }

  return { ok: true, lines: out };
}
