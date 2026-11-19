import type { Citation } from "../protocol";
import type { StoredDocument } from "./types";

export interface Located {
    start: number;
    end: number;
}

interface Compact {
    text: string;
    /** For each character of `text`, its offset in the original string. */
    offsets: number[];
}

/** The text without whitespace, with a map back to the original offsets. PDF text and the model's quote often differ only in spacing and line breaks. */
function compact(text: string, from: number, to: number): Compact {
    let squeezed = "";
    const offsets: number[] = [];
    for (let index = from; index < to; index += 1) {
        const char = text.charAt(index);
        if (/\s/.test(char)) continue;
        squeezed += char;
        offsets.push(index);
    }
    return { text: squeezed, offsets };
}

/** Finds a quote inside `text[from, to)` ignoring whitespace differences. When only the beginning of a long quote matches, the range runs for the quote's length. */
export function findQuote(text: string, quote: string, from = 0, to = text.length): Located | null {
    const haystack = compact(text, from, to);
    const needle = compact(quote, 0, quote.length).text;
    if (needle.length === 0) return null;

    const whole = haystack.text.indexOf(needle);
    if (whole !== -1) return mapBack(haystack, whole, whole + needle.length);

    const head = needle.slice(0, 40);
    const partial = needle.length > head.length ? haystack.text.indexOf(head) : -1;
    if (partial === -1) return null;
    return mapBack(haystack, partial, Math.min(haystack.text.length, partial + needle.length));
}

function mapBack(source: Compact, first: number, endExclusive: number): Located | null {
    const start = source.offsets[first];
    const last = source.offsets[endExclusive - 1];
    return start === undefined || last === undefined ? null : { start, end: last + 1 };
}

/**
 * Where a citation points inside the document as it is stored. A character range is used as given when it fits
 * the text. A page is searched for the quoted text. Without either, the whole document is searched. Returns null
 * when the place cannot be found, for example when the stored text and the quote disagree.
 */
export function locateCitation(
    document: Pick<StoredDocument, "text" | "pages">,
    citation: Pick<Citation, "quote" | "start" | "end" | "startPage" | "endPage">,
): Located | null {
    const { text } = document;
    const { start, end } = citation;
    if (start !== undefined && end !== undefined && start < end && end <= text.length) return { start, end };

    if (citation.startPage !== undefined && document.pages) {
        const first = document.pages.find((span) => span.page === citation.startPage);
        const last = document.pages.find((span) => span.page === (citation.endPage ?? citation.startPage)) ?? first;
        if (first && last) return findQuote(text, citation.quote, first.start, last.end);
    }
    return findQuote(text, citation.quote);
}
