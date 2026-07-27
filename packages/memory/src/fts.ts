/**
 * Escape/quote user terms for FTS5 MATCH. Never pass raw focused-question text.
 */
export function buildFtsMatchQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s"-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t !== '""');

  if (tokens.length === 0) return '""';

  // Phrase if user supplied quotes; otherwise AND of quoted tokens.
  const phraseMatch = raw.match(/"([^"]+)"/);
  if (phraseMatch?.[1]) {
    const phrase = phraseMatch[1].replace(/"/g, "").trim();
    if (phrase.length >= 2) return `"${phrase}"`;
  }

  return tokens
    .slice(0, 12)
    .map((t) => `"${t.replace(/"/g, "")}"`)
    .join(" AND ");
}

export function estimateTokens(text: string): number {
  // Rough heuristic: ~4 chars/token.
  return Math.max(1, Math.ceil(text.length / 4));
}
