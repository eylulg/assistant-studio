'use client';

import {
  Children,
  type ComponentProps,
  Fragment,
  type ReactNode,
  createContext,
  isValidElement,
  useContext,
} from 'react';
import { CodeBlock } from '@eylulg/ui/code-block';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LINK_CLASS } from '@/components/styles';
import { annotate, citationKey } from '@/lib/chat/citations';
import type { PlacedCitation } from '@/lib/chat/types';
import { CitationChip } from './citation-chip';

/** Chips are placed in the text as private-use markers before parsing, then swapped for buttons where the parser leaves them. */
const MARKER_START = '\uE000';
const MARKER_END = '\uE001';
const MARKER_PATTERN = /\uE000(\d+)\uE001/g;

interface CitationContextValue {
  placed: readonly PlacedCitation[];
  numbers: ReadonlyMap<string, number>;
}

const CitationContext = createContext<CitationContextValue | null>(null);

/** Replaces the markers in the text children of an element with citation chips. */
function WithChips({ children }: { children?: ReactNode }) {
  const context = useContext(CitationContext);
  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child !== 'string') return child;
        const parts = child.split(MARKER_PATTERN);
        if (parts.length === 1) return child;
        return parts.map((part, index) => {
          if (index % 2 === 0) return part ? <Fragment key={index}>{part}</Fragment> : null;
          const entry = context?.placed[Number(part)];
          const number = entry ? context?.numbers.get(citationKey(entry.citation)) : undefined;
          return entry && number ? (
            <CitationChip key={index} number={number} citation={entry.citation} />
          ) : null;
        });
      })}
    </>
  );
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}

/** A fenced block arrives as <pre><code class="language-ts">. Render it with the library's CodeBlock. */
function Pre({ children }: ComponentProps<'pre'>) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child))
    return <pre>{children}</pre>;
  const language = /language-([\w-]+)/.exec(child.props.className ?? '')?.[1];
  const code = textOf(child.props.children).replace(/\n$/, '');
  return (
    <CodeBlock
      label={language ? `${language} code` : 'Code'}
      copyLabel={language ? `Copy ${language} code` : 'Copy code'}
      copyable
    >
      {code}
    </CodeBlock>
  );
}

function Anchor({ href, children }: ComponentProps<'a'>) {
  return (
    <a className={LINK_CLASS} href={href} target='_blank' rel='noopener noreferrer'>
      {children}
    </a>
  );
}

function TableWrap({ children }: ComponentProps<'table'>) {
  return (
    <div
      role='region'
      aria-label='Table'
      // A wide table scrolls sideways, so the wrapper has to be reachable by keyboard.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className='overflow-x-auto rounded-md outline-none focus-visible:outline-2 focus-visible:outline-focus'
    >
      <table className='w-full border-collapse text-sm'>{children}</table>
    </div>
  );
}

/** Headings in an answer would break the page's heading order, so they render as bold paragraphs. */
function Heading({ children }: ComponentProps<'h1'>) {
  return <p className='font-semibold text-primary'>{children}</p>;
}

const COMPONENTS: Components = {
  pre: Pre,
  a: Anchor,
  table: TableWrap,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  code: ({ children }) => (
    <code className='rounded-sm bg-tertiary px-1 py-0.5 font-data text-[0.9em]'>
      {textOf(children).replace(MARKER_PATTERN, '')}
    </code>
  ),
  p: ({ children }) => (
    <p className='leading-relaxed'>
      <WithChips>{children}</WithChips>
    </p>
  ),
  li: ({ children }) => (
    <li>
      <WithChips>{children}</WithChips>
    </li>
  ),
  strong: ({ children }) => (
    <strong>
      <WithChips>{children}</WithChips>
    </strong>
  ),
  em: ({ children }) => (
    <em>
      <WithChips>{children}</WithChips>
    </em>
  ),
  ul: ({ children }) => <ul className='list-disc space-y-1 pl-5'>{children}</ul>,
  ol: ({ children }) => <ol className='list-decimal space-y-1 pl-5'>{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className='border-l-2 border-default pl-4 text-secondary'>{children}</blockquote>
  ),
  th: ({ children }) => (
    <th className='border-b border-default px-3 py-2 text-left font-semibold'>{children}</th>
  ),
  td: ({ children }) => (
    <td className='border-b border-subtle px-3 py-2'>
      <WithChips>{children}</WithChips>
    </td>
  ),
  img: ({ alt }) => <span>{alt}</span>,
};

const PLUGINS = [remarkGfm];

/** Markdown from the model. Raw HTML is never rendered: react-markdown escapes it. Citations, when there are any, become numbered chips at their positions. */
export function Markdown({
  children,
  citations,
  numbers,
}: {
  children: string;
  citations?: readonly PlacedCitation[];
  numbers?: ReadonlyMap<string, number>;
}) {
  const text = citations?.length
    ? annotate(children, citations, (index) => `${MARKER_START}${index}${MARKER_END}`)
    : children;
  const context = citations && numbers ? { placed: citations, numbers } : null;
  return (
    <CitationContext value={context}>
      <div className='flex flex-col gap-3 text-md text-primary'>
        <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    </CitationContext>
  );
}
