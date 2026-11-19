import type { Passage } from './types';

const K1 = 1.2;
const B = 0.75;

/** Words that carry no topic. Kept short on purpose: BM25's inverse document frequency already down-weights common words. */
const STOP_WORDS = new Set(
  'a an and are as at be by can do does for from has have how i in is it its of on or that the their there this to was were what when where which who why will with you your'.split(
    ' ',
  ),
);

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => !STOP_WORDS.has(word) && (word.length > 1 || /\d/.test(word)));
}

export interface RankedPassage {
  passage: Passage;
  score: number;
}

/** Ranks passages against a question with Okapi BM25. Passages that share no term with the question are left out. */
export function rankPassages(question: string, passages: readonly Passage[]): RankedPassage[] {
  const terms = [...new Set(tokenize(question))];
  if (terms.length === 0 || passages.length === 0) return [];

  const documents = passages.map((passage) => {
    const counts = new Map<string, number>();
    const tokens = tokenize(passage.text);
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return { passage, counts, length: tokens.length };
  });
  const average = documents.reduce((sum, entry) => sum + entry.length, 0) / documents.length || 1;

  const idf = new Map<string, number>();
  for (const term of terms) {
    const containing = documents.filter((entry) => entry.counts.has(term)).length;
    idf.set(term, Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5)));
  }

  return documents
    .map(({ passage, counts, length }) => {
      let score = 0;
      for (const term of terms) {
        const frequency = counts.get(term) ?? 0;
        if (frequency === 0) continue;
        score +=
          (idf.get(term) ?? 0) *
          ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / average)));
      }
      return { passage, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.passage.start - b.passage.start);
}
