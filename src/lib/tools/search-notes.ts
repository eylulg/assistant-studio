import { z } from "zod";
import { NOTES, type Note } from "./notes-corpus";
import { defineTool } from "./types";

const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "my",
    "of",
    "on",
    "or",
    "the",
    "to",
    "what",
    "when",
    "where",
    "with",
]);

function normalise(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
}

function terms(text: string): string[] {
    return (normalise(text).match(/[a-z0-9]+/g) ?? []).filter((word) => !STOP_WORDS.has(word)).map(stem);
}

function stem(word: string): string {
    if (word.length > 4 && word.endsWith("ing")) return word.slice(0, -3);
    if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
    return word;
}

interface Indexed {
    note: Note;
    title: string[];
    tags: string[];
    body: string[];
}

const INDEX: Indexed[] = NOTES.map((note) => ({ note, title: terms(note.title), tags: note.tags.flatMap(terms), body: terms(note.body) }));

function inverseDocumentFrequency(term: string): number {
    const containing = INDEX.filter((entry) => [...entry.title, ...entry.tags, ...entry.body].some((word) => word === term)).length;
    return Math.log(1 + (INDEX.length - containing + 0.5) / (containing + 0.5));
}

function fieldScore(words: string[], term: string, weight: number): number {
    let count = 0;
    let prefix = 0;
    for (const word of words) {
        if (word === term) count += 1;
        else if (term.length >= 4 && word.startsWith(term)) prefix += 1;
    }
    return weight * ((count * 2.2) / (count + 1.2) + prefix * 0.3);
}

function snippet(note: Note, queryTerms: string[]): string {
    const sentences = note.body.split(/(?<=[.?!])\s+/);
    const best = sentences.find((sentence) => terms(sentence).some((word) => queryTerms.includes(word))) ?? sentences[0] ?? "";
    return best.length > 180 ? `${best.slice(0, 177).trimEnd()}...` : best;
}

export interface NoteMatch {
    id: string;
    title: string;
    snippet: string;
    score: number;
}

export function searchNotes(query: string, limit: number): NoteMatch[] {
    const queryTerms = terms(query);
    if (queryTerms.length === 0) return [];

    return INDEX.map((entry) => {
        let score = 0;
        for (const term of queryTerms) {
            const weight = inverseDocumentFrequency(term);
            score += weight * (fieldScore(entry.title, term, 3) + fieldScore(entry.tags, term, 2) + fieldScore(entry.body, term, 1));
        }
        return { entry, score };
    })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.note.id.localeCompare(b.entry.note.id))
        .slice(0, limit)
        .map(({ entry, score }) => ({ id: entry.note.id, title: entry.note.title, snippet: snippet(entry.note, queryTerms), score: Number(score.toFixed(2)) }));
}

export const searchNotesTool = defineTool({
    name: "search_notes",
    description:
        "Full-text search over the user's notebook of about 30 sample notes. Returns the best matches with an id such as note-06. Cite the id when you use a note.",
    sideEffect: false,
    schema: z.object({
        query: z.string().min(1).max(200).describe("Keywords, for example lentil soup"),
        limit: z.number().int().min(1).max(10).optional().describe("Number of matches, 3 by default"),
    }),
    run: ({ query, limit }) => {
        const matches = searchNotes(query, limit ?? 3);
        return { query, count: matches.length, matches };
    },
});
