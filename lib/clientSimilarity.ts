// Fuzzy "is this the same client?" check for the New Project form — pure, no
// database — so a client name/company typed while creating a project can be
// compared against already-existing projects client-side, live as they type.
//
// No fuzzy-matching library exists anywhere in this codebase (checked) —
// every existing "duplicate" concept (lib/leadStore.ts's normalizeMobile/
// normalizeEmail, lib/clientMasterStore.ts's normalizeKey) is exact-match
// after trivial normalization, which doesn't catch "Acme Corp" vs "Acme
// Corporation" or a typo'd name. This adds the one thing missing: a small
// Levenshtein-based similarity score, following the same normalize-then-
// compare shape as those existing helpers.

export function normalizeClientText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Legal-form words that say nothing about WHICH client this is. Stripped
// only from the end, and only as whole words, so "Patel Industries" and
// "Patel Trading" stay distinct while "Acme Pvt Ltd", "Acme Ltd." and
// "Acme" become one row.
const LEGAL_SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt limited',
  'private ltd',
  'limited',
  'private',
  'llp',
  'ltd',
  'inc',
  'incorporated',
  'corporation',
  'corp',
  'company',
  'co'
];

/**
 * The key Client Master groups rows by.
 *
 * Client Master is derived from Projects and Leads, so the "client" is
 * whatever was typed into each one. Grouping on trim+lowercase alone — what
 * it did before — left the same customer sitting on several rows whenever
 * the spelling differed by punctuation, spacing or a legal suffix:
 * "Adani Pvt. Ltd.", "Adani Pvt Ltd" and "ADANI  LTD" were three clients.
 *
 * So this also collapses internal whitespace, drops punctuation, and removes
 * a trailing legal form. Deliberately conservative: it merges only names
 * that differ by noise. Two genuinely different clients whose names differ
 * by a real word still get their own rows — merging those would be far worse
 * than leaving a duplicate, because it would hide one client's projects
 * inside another's.
 *
 * NOT fuzzy. textSimilarity below exists for the "did you mean?" nudge,
 * where a human confirms; grouping happens with no human in the loop, so it
 * stays exact-after-normalisation.
 */
export function clientDirectoryKey(value: string): string {
  let key = normalizeClientText(value)
    // Punctuation to spaces rather than nothing: "a.b.c" is three words, not
    // one, and "acme-industries" should match "acme industries".
    .replace(/[.,'"&/\\()\-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Repeatedly, so "Acme Pvt. Ltd. Co." reduces all the way down.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (key === suffix) break; // the name IS the suffix — keep it rather than empty the key
      if (key.endsWith(` ${suffix}`)) {
        key = key.slice(0, -(suffix.length + 1)).trim();
        changed = true;
        break;
      }
    }
  }

  return key;
}

// Classic edit-distance DP. Inputs here are always short (person/company
// names), so the O(n*m) table is negligible — no need for the rolling-array
// optimization.
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// 0 (nothing alike) .. 1 (identical once normalized). A short string fully
// contained in a longer one ("Acme" inside "Acme Corporation") scores high
// without being penalized by the length difference edit-distance alone would
// impose.
export function textSimilarity(a: string, b: string): number {
  const na = normalizeClientText(a);
  const nb = normalizeClientText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
}

export interface ClientMatchCandidate {
  id: string;
  clientName: string;
  company: string;
}

export interface ClientMatch {
  project: ClientMatchCandidate;
  score: number;
}

// Below this, two names are more "coincidentally share a few letters" than
// "probably the same client" — tuned to catch typos/abbreviations/suffix
// differences without flagging genuinely different names.
const MATCH_THRESHOLD = 0.72;
// Matching on a 1-2 character fragment produces noise while someone is still
// typing the first few letters of a name.
const MIN_INPUT_LENGTH = 3;

// Best match across BOTH fields — whichever one the typed value(s) actually
// resemble — so "Acme Corp" vs an existing company "Acme Corporation", and
// "Rohan Shah" vs an existing client_name "Rohan Shahh", both surface.
export function findClosestClient(
  clientName: string,
  company: string,
  candidates: ClientMatchCandidate[]
): ClientMatch | null {
  const name = clientName.trim();
  const co = company.trim();
  if (name.length < MIN_INPUT_LENGTH && co.length < MIN_INPUT_LENGTH) return null;

  let best: ClientMatch | null = null;
  for (const candidate of candidates) {
    const scores: number[] = [];
    if (name.length >= MIN_INPUT_LENGTH && candidate.clientName) scores.push(textSimilarity(name, candidate.clientName));
    if (co.length >= MIN_INPUT_LENGTH && candidate.company) scores.push(textSimilarity(co, candidate.company));
    if (!scores.length) continue;
    const score = Math.max(...scores);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { project: candidate, score };
    }
  }
  return best;
}
