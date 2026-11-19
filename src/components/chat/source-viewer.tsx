'use client';

import { useEffect, useRef } from 'react';
import { HIGHLIGHT_CLASS, META_CLASS } from '@/components/styles';
import { pagePlace } from '@/lib/chat/citations';
import { type Located, citedPages, locateCitation } from '@/lib/documents/locate';
import { formatNumber } from '@/lib/format';
import type { Citation } from '@/lib/protocol';
import { useDocuments, useStudio } from '../studio-context';

function describePlace(citation: Citation, located: Located | null): string {
  const page = pagePlace(citation);
  const prefix = page ? `${page.charAt(0).toUpperCase()}${page.slice(1)}. ` : '';
  if (!located)
    return `${prefix}The quoted text could not be matched exactly, so no range is highlighted.`;
  return `${prefix}Characters ${formatNumber(located.start)} to ${formatNumber(located.end)} are highlighted.`;
}

/** The text of a cited document with the cited range highlighted and scrolled into view. */
export function SourceViewer({ citation }: { citation: Citation }) {
  const activeId = useStudio((state) => state.activeId);
  const entry = useDocuments((state) =>
    activeId
      ? state.entries[activeId]?.find((candidate) => candidate.id === citation.documentId)
      : undefined,
  );
  const markRef = useRef<HTMLElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mark = markRef.current;
    if (mark) mark.scrollIntoView({ block: 'center' });
    else regionRef.current?.scrollTo({ top: 0 });
  }, []);

  if (!entry?.text) {
    return (
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-secondary'>
          This document is no longer in the conversation, so only the quoted text is shown.
        </p>
        <blockquote className='border-l-2 border-default pl-4 text-sm whitespace-pre-wrap text-primary'>
          {citation.quote}
        </blockquote>
      </div>
    );
  }

  const located = locateCitation({ text: entry.text, pages: entry.pages }, citation);
  const visible = citedPages(entry.pages, citation) ?? { start: 0, end: entry.text.length };
  const before = entry.text.slice(
    visible.start,
    located ? Math.max(visible.start, located.start) : visible.end,
  );
  const cited = located ? entry.text.slice(located.start, located.end) : '';
  const after = located ? entry.text.slice(located.end, visible.end) : '';

  return (
    <div className='flex flex-col gap-3'>
      <p className={META_CLASS}>{describePlace(citation, located)}</p>
      <div
        ref={regionRef}
        role='region'
        aria-label={`Text of ${citation.documentName}`}
        // The text scrolls, so the region has to be reachable by keyboard.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className='max-h-[55dvh] overflow-y-auto rounded-md border border-subtle p-3 outline-none focus-visible:outline-2 focus-visible:outline-focus'
      >
        <p className='text-sm leading-relaxed whitespace-pre-wrap text-primary'>
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
