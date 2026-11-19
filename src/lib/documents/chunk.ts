import type { PageSpan, Passage, StoredDocument } from "./types";

/** Passages grow by whole paragraphs up to this size, so a quote stays short enough to read in an answer. */
const TARGET_CHARS = 500;
/** A paragraph longer than this is split at sentence ends. */
const MAX_CHARS = 800;

interface Range {
    start: number;
    end: number;
}

function trimmed(text: string, start: number, end: number): Range | null {
    let from = start;
    let to = end;
    while (from < to && /\s/.test(text.charAt(from))) from += 1;
    while (to > from && /\s/.test(text.charAt(to - 1))) to -= 1;
    return to > from ? { start: from, end: to } : null;
}

function paragraphs(text: string, start: number, end: number): Range[] {
    const found: Range[] = [];
    const separator = /\n[^\S\n]*\n\s*/g;
    const region = text.slice(start, end);
    let from = 0;
    for (const match of region.matchAll(separator)) {
        const range = trimmed(text, start + from, start + match.index);
        if (range) found.push(range);
        from = match.index + match[0].length;
    }
    const last = trimmed(text, start + from, end);
    if (last) found.push(last);
    return found;
}

/** Splits an overlong paragraph at sentence ends, and at a space when one sentence alone is too long. */
function split(text: string, range: Range): Range[] {
    if (range.end - range.start <= MAX_CHARS) return [range];
    const pieces: Range[] = [];
    let from = range.start;
    while (from < range.end) {
        let to = Math.min(range.end, from + MAX_CHARS);
        if (to < range.end) {
            const window = text.slice(from, to);
            const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf(".\n"));
            const space = window.lastIndexOf(" ");
            if (sentenceEnd > TARGET_CHARS / 2) to = from + sentenceEnd + 1;
            else if (space > TARGET_CHARS / 2) to = from + space;
        }
        const piece = trimmed(text, from, to);
        if (piece) pieces.push(piece);
        from = to;
    }
    return pieces;
}

function chunkRegion(text: string, start: number, end: number): Range[] {
    const units = paragraphs(text, start, end).flatMap((paragraph) => split(text, paragraph));
    const passages: Range[] = [];
    let current: Range | null = null;
    for (const unit of units) {
        if (current && unit.end - current.start <= TARGET_CHARS) current = { start: current.start, end: unit.end };
        else {
            if (current) passages.push(current);
            current = unit;
        }
    }
    if (current) passages.push(current);
    return passages;
}

/**
 * Splits a document into passages with exact character offsets. A PDF is split page by page, so no passage
 * crosses a page and each carries its page number.
 */
export function chunkDocument(document: Pick<StoredDocument, "id" | "text" | "pages">): Passage[] {
    const regions: { start: number; end: number; page?: number }[] = document.pages
        ? document.pages.map((span: PageSpan) => ({ start: span.start, end: span.end, page: span.page }))
        : [{ start: 0, end: document.text.length }];
    return regions.flatMap((region) =>
        chunkRegion(document.text, region.start, region.end).map((range) => ({
            documentId: document.id,
            start: range.start,
            end: range.end,
            text: document.text.slice(range.start, range.end),
            ...(region.page === undefined ? {} : { page: region.page }),
        })),
    );
}
