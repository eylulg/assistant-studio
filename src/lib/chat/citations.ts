import type { Citation } from "../protocol";
import type { Part, PlacedCitation } from "./types";

/** Two citations are the same source when they point at the same place in the same document. */
export function citationKey(citation: Citation): string {
    return [
        citation.documentId,
        citation.start ?? "",
        citation.end ?? "",
        citation.startPage ?? "",
        citation.endPage ?? "",
        citation.start === undefined ? citation.quote : "",
    ].join("|");
}

/** Chip numbers for one answer: sources are numbered from 1 in the order they first appear, and a source cited twice keeps its number. */
export function numberCitations(parts: readonly Part[]): Map<string, number> {
    const numbers = new Map<string, number>();
    for (const part of parts) {
        if (part.type !== "text") continue;
        for (const { citation } of part.citations ?? []) {
            const key = citationKey(citation);
            if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
        }
    }
    return numbers;
}

/** "page 3" or "pages 3 to 4" for a PDF citation, null for a text file. */
export function pagePlace(citation: Citation): string | null {
    if (citation.startPage === undefined) return null;
    return citation.endPage !== undefined && citation.endPage !== citation.startPage
        ? `pages ${citation.startPage} to ${citation.endPage}`
        : `page ${citation.startPage}`;
}

/** The accessible name of a chip: the number, the document and, for a PDF, the page. */
export function citationLabel(number: number, citation: Citation): string {
    const place = pagePlace(citation);
    return `Source ${number}: ${citation.documentName}${place ? `, ${place}` : ""}`;
}

/** Inserts a marker into text at each citation's position. Later positions go first so earlier offsets stay valid. */
export function annotate(text: string, placed: readonly PlacedCitation[], marker: (index: number) => string): string {
    return placed
        .map((entry, index) => ({ at: Math.min(entry.at, text.length), index }))
        .toSorted((a, b) => b.at - a.at || b.index - a.index)
        .reduce((result, { at, index }) => result.slice(0, at) + marker(index) + result.slice(at), text);
}
