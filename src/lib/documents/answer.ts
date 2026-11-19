import type { Citation, StreamEvent } from "../protocol";
import { sleep } from "../tools/types";
import { rankPassages } from "./bm25";
import { chunkDocument } from "./chunk";
import type { Passage, StoredDocument } from "./types";

type AnswerDocument = Pick<StoredDocument, "id" | "name" | "text" | "pages">;

const MAX_QUOTES = 3;
/** A later passage must score at least this share of the best one, so weak matches are not quoted just to fill the answer. */
const MIN_RELATIVE_SCORE = 0.4;
const CHUNK_CHARS = 14;
const CHUNK_DELAY_MS = 12;
const CACHED_DOCUMENTS = 30;

/** Passages per document id, reused while the text is the same string, so a question does not chunk every document again. */
const passageCache = new Map<string, { text: string; passages: Passage[] }>();

function passagesOf(document: AnswerDocument): Passage[] {
    const cached = passageCache.get(document.id);
    if (cached?.text === document.text) return cached.passages;
    const passages = chunkDocument(document);
    passageCache.delete(document.id);
    passageCache.set(document.id, { text: document.text, passages });
    const oldest = passageCache.keys().next().value;
    if (passageCache.size > CACHED_DOCUMENTS && oldest !== undefined) passageCache.delete(oldest);
    return passages;
}

type Piece = { type: "text"; text: string } | { type: "citation"; citation: Citation };

/** Text pasted into a Markdown quote must stay literal. */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]<>#|~]/g, "\\$&");
}

function quoteBlock(text: string): string {
    return (
        text
            .split("\n")
            .map((line) => `> ${escapeMarkdown(line)}`)
            // Two trailing spaces make Markdown keep the line breaks of the source instead of running the lines together.
            .join("  \n")
    );
}

function citationFor(passage: Passage, document: AnswerDocument): Citation {
    return {
        documentId: document.id,
        documentName: document.name,
        quote: passage.text,
        start: passage.start,
        end: passage.end,
        ...(passage.page === undefined ? {} : { startPage: passage.page, endPage: passage.page }),
    };
}

/**
 * Builds an answer by quoting the passages of the documents that best match the question, ranked with BM25.
 * Nothing here is generated: every quoted character is copied from the document at the cited range.
 */
export function composeExtractiveAnswer(question: string, documents: readonly AnswerDocument[]): Piece[] {
    const byId = new Map(documents.map((document) => [document.id, document]));
    const ranked = rankPassages(question, documents.flatMap(passagesOf));
    const best = ranked[0]?.score ?? 0;
    const chosen = ranked.filter((entry) => entry.score >= best * MIN_RELATIVE_SCORE).slice(0, MAX_QUOTES);

    if (chosen.length === 0) {
        const names = documents.map((document) => document.name).join(", ");
        return [
            {
                type: "text",
                text: `Nothing in your documents matches this question. The search compares the words you used with the words in the documents, so try other words from the document. Searched: ${names}.`,
            },
        ];
    }

    const pieces: Piece[] = [{ type: "text", text: "These passages from your documents match your question best.\n\n" }];
    chosen.forEach(({ passage }, index) => {
        const document = byId.get(passage.documentId);
        if (!document) return;
        const place = passage.page === undefined ? "" : `, page ${passage.page}`;
        pieces.push({ type: "text", text: `**${escapeMarkdown(document.name)}${place}**\n\n${quoteBlock(passage.text)}` });
        pieces.push({ type: "citation", citation: citationFor(passage, document) });
        if (index < chosen.length - 1) pieces.push({ type: "text", text: "\n\n" });
    });
    return pieces;
}

/** Streams an extractive answer through the same events a model answer uses, in small chunks so the interface behaves the same. */
export async function* streamExtractiveAnswer(
    question: string,
    documents: readonly AnswerDocument[],
    options: { signal?: AbortSignal; paceScale?: number } = {},
): AsyncGenerator<StreamEvent> {
    const scale = options.paceScale ?? 1;
    yield { type: "answer_mode", mode: "extractive" };
    yield { type: "round_start" };
    for (const piece of composeExtractiveAnswer(question, documents)) {
        if (piece.type === "citation") {
            yield piece;
            continue;
        }
        for (const text of piece.text.match(new RegExp(`[^]{1,${CHUNK_CHARS}}`, "g")) ?? []) {
            if (scale > 0) await sleep(CHUNK_DELAY_MS * scale, options.signal);
            yield { type: "text", text };
        }
    }
    yield { type: "done", reason: "end_turn" };
}
