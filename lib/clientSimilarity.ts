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
