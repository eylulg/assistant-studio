"use client";

import { useEffect, useRef } from "react";
import { HIGHLIGHT_CLASS, META_CLASS } from "@/components/styles";
import { locateCitation } from "@/lib/documents/locate";
import type { Citation } from "@/lib/protocol";
import { useDocuments, useStudio } from "../studio-context";

const number = new Intl.NumberFormat("en");

/** Where the viewer reads from: the cited pages of a PDF, or the whole text of a text file. */
function visibleRange(text: string, pages: { page: number; start: number; end: number }[] | undefined, citation: Citation): { start: number; end: number } {
    if (citation.startPage === undefined || !pages) return { start: 0, end: text.length };
    const first = pages.find((span) => span.page === citation.startPage);
    const last = pages.find((span) => span.page === (citation.endPage ?? citation.startPage)) ?? first;
    return first && last ? { start: first.start, end: last.end } : { start: 0, end: text.length };
}

function describePlace(citation: Citation, located: { start: number; end: number } | null): string {
    const page =
        citation.startPage === undefined
            ? ""
            : citation.endPage !== undefined && citation.endPage !== citation.startPage
              ? `Pages ${citation.startPage} to ${citation.endPage}. `
              : `Page ${citation.startPage}. `;
    if (!located) return `${page}The quoted text could not be matched exactly, so no range is highlighted.`;
    return `${page}Characters ${number.format(located.start)} to ${number.format(located.end)} are highlighted.`;
}

/** The text of a cited document with the cited range highlighted and scrolled into view. */
export function SourceViewer({ citation }: { citation: Citation }) {
    const activeId = useStudio((state) => state.activeId);
    const entry = useDocuments((state) => (activeId ? state.entries[activeId]?.find((candidate) => candidate.id === citation.documentId) : undefined));
    const markRef = useRef<HTMLElement>(null);
    const regionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const mark = markRef.current;
        if (mark) mark.scrollIntoView({ block: "center" });
        else regionRef.current?.scrollTo({ top: 0 });
    }, []);

    if (!entry?.text) {
        return (
            <div className="flex flex-col gap-3">
                <p className="text-sm text-secondary">This document is no longer in the conversation, so only the quoted text is shown.</p>
                <blockquote className="border-l-2 border-default pl-4 text-sm whitespace-pre-wrap text-primary">{citation.quote}</blockquote>
            </div>
        );
    }

    const located = locateCitation({ text: entry.text, pages: entry.pages }, citation);
    const visible = visibleRange(entry.text, entry.pages, citation);
    const before = entry.text.slice(visible.start, located ? Math.max(visible.start, located.start) : visible.end);
    const cited = located ? entry.text.slice(located.start, located.end) : "";
    const after = located ? entry.text.slice(located.end, visible.end) : "";

    return (
        <div className="flex flex-col gap-3">
            <p className={META_CLASS}>{describePlace(citation, located)}</p>
            <div
                ref={regionRef}
                role="region"
                aria-label={`Text of ${citation.documentName}`}
                // The text scrolls, so the region has to be reachable by keyboard.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={0}
                className="max-h-[55dvh] overflow-y-auto rounded-md border border-subtle p-3 outline-none focus-visible:outline-2 focus-visible:outline-focus"
            >
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-primary">
                    {before}
                    {located ? (
                        <mark ref={markRef} className={HIGHLIGHT_CLASS}>
                            {cited}
                        </mark>
                    ) : null}
                    {after}
                </p>
            </div>
        </div>
    );
}
