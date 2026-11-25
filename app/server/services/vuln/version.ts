/* Version parsing and comparison for CVE ranges.

   Precision beats recall: whenever two versions cannot be compared with
   confidence (vendor build names like "R31 P3" or "25H2", git hashes, a
   version that is only a prefix of the boundary) the answer is `null`, and
   the caller treats the result as "unknown", never as "not affected". */

export interface Version {
  nums: number[];
  /* "-rc1", "-beta2", "~alpha": sorts before the same numbers without it. */
  pre: boolean;
}

const PRE_RELEASE = /^[-~.]?(alpha|beta|rc|pre|preview|dev|snapshot)(?![a-z])/i;

/* "v1.27.3" → [1,27,3]; "1.1.1w" → [1,1,1,23]; "24.04 LTS" → [24,4];
   "8.0.36-1ubuntu" → [8,0,36]. null for anything not starting with a
   number or with letters glued to it ("25H2", "R31", "n/a", git hashes). */
export function parseVersion(raw: string | null | undefined): Version | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^v(?=\d)/i, '');
  const m = s.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return null;
  const nums = m[1].split('.').map(Number);
  if (nums.some((n) => !Number.isSafeInteger(n))) return null;
  const rest = m[2];
  if (/^[a-f0-9]{7,}$/i.test(s)) return null; // looks like a git hash
  if (rest === '') return { nums, pre: false };
  /* OpenSSL style single letter: 1.1.1w */
  if (/^[a-z]$/i.test(rest)) return { nums: [...nums, rest.toLowerCase().charCodeAt(0) - 96], pre: false };
  if (/^[a-z]/i.test(rest)) return null;
  if (rest === '.*') return null; // wildcard: see parseBound
  return { nums, pre: PRE_RELEASE.test(rest) };
}

/* -1 / 0 / 1, or null when `a` is a strict prefix of `b` (or the other
   way round) and the missing components are not all zero: "17.5" vs
   "17.5.1" is not decidable from the information given. */
export function compareVersions(a: Version, b: Version): -1 | 0 | 1 | null {
  const n = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < n; i++) {
    const x = a.nums[i];
    const y = b.nums[i];
    if (x === undefined || y === undefined) {
      const tail = (x === undefined ? b.nums : a.nums).slice(i);
      if (tail.every((t) => t === 0)) break;
      return null;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.pre !== b.pre) return a.pre ? -1 : 1;
  return 0;
}

/* A range boundary as CVE records write it. */
export type Bound =
  | { kind: 'any' } // "*", "0", "" as lower bound; "*" as upper bound
  | { kind: 'version'; v: Version }
  | { kind: 'prefix'; nums: number[] }; // "5.10.*" / "8.1.*"

export function parseBound(raw: string | null | undefined): Bound | null {
  if (raw === undefined || raw === null) return null;
  const s = raw.trim();
  if (s === '*' || s === '') return { kind: 'any' };
  const wild = s.match(/^v?(\d+(?:\.\d+)*)\.\*$/i);
  if (wild) return { kind: 'prefix', nums: wild[1].split('.').map(Number) };
  const v = parseVersion(s);
  return v ? { kind: 'version', v } : null;
}

/* Compares `v` against a lower bound. true/false, or null if undecidable. */
export function atLeast(v: Version, bound: Bound, inclusive: boolean): boolean | null {
  if (bound.kind === 'any') return true;
  if (bound.kind === 'prefix') {
    const c = compareVersions({ nums: v.nums.slice(0, bound.nums.length), pre: false }, { nums: bound.nums, pre: false });
    return c === null ? null : c >= 0;
  }
  if (bound.v.nums.length === 1 && bound.v.nums[0] === 0 && !bound.v.pre) return true; // "0" = from the start
  const c = compareVersions(v, bound.v);
  if (c === null) return null;
  return inclusive ? c >= 0 : c > 0;
}

/* Compares `v` against an upper bound. */
export function atMost(v: Version, bound: Bound, inclusive: boolean): boolean | null {
  if (bound.kind === 'any') return true;
  if (bound.kind === 'prefix') {
    const c = compareVersions({ nums: v.nums.slice(0, bound.nums.length), pre: false }, { nums: bound.nums, pre: false });
    return c === null ? null : c <= 0;
  }
  const c = compareVersions(v, bound.v);
  if (c === null) return null;
  return inclusive ? c <= 0 : c < 0;
}

/* Same release branch (major.minor), used for CVE "changes" lists. */
export function sameBranch(a: Version, b: Version): boolean {
  return a.nums[0] === b.nums[0] && (a.nums[1] ?? 0) === (b.nums[1] ?? 0);
}
