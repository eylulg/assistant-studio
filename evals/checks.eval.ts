import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newAssistantMessage } from '@/lib/chat/reducer';
import type { ToolPart } from '@/lib/chat/types';
import type { Citation } from '@/lib/protocol';
import type { EvalCase } from './cases';
import { evaluateCase } from './checks';
import { fixture } from './documents/fixtures';
import type { RunResult } from './harness';

const testCase: EvalCase = {
  id: 'demo',
  prompt: 'p',
  expect: {
    tools: [{ name: 'search_notes', input: z.object({ query: z.string().regex(/lentil/i) }) }],
    answer: { contains: ['cumin'], notContains: [/invented/i], maxChars: 40, citesNote: 'note-06' },
  },
};

const FOUND = '{"matches":[{"id":"note-06"}]}';

function run(overrides: { tools?: Partial<ToolPart>[]; text?: string }): RunResult {
  const tools: ToolPart[] = (overrides.tools ?? [{ input: { query: 'lentil soup' } }]).map(
    (tool, index) => ({
      type: 'tool',
      round: 0,
      id: `t${index}`,
      name: 'search_notes',
      status: 'done',
      rawInput: '',
      output: FOUND,
      ...tool,
    }),
  );
  return {
    message: newAssistantMessage('a', 'm', 't'),
    tools,
    text: overrides.text ?? 'Cumin [note-06]',
    tasks: [],
    citations: [],
  };
}

function failures(result: RunResult) {
  return evaluateCase(testCase, result)
    .filter((check) => !check.passed)
    .map((check) => check.name);
}

describe('the eval checks catch what they are meant to catch', () => {
  it('pass a good run', () => {
    expect(failures(run({}))).toEqual([]);
  });

  it.each([
    [
      'the wrong tool input shape',
      run({ tools: [{ input: { query: 'pasta' } }] }),
      ['tool: search_notes', 'no unexpected tools'],
    ],
    [
      'a tool nobody expected',
      run({ tools: [{ input: { query: 'lentil' } }, { name: 'calculate', input: {} }] }),
      ['no unexpected tools'],
    ],
    ['a missing tool call', run({ tools: [] }), ['tool: search_notes', 'cites note-06']],
    [
      'a tool that failed',
      run({ tools: [{ input: { query: 'lentil' }, status: 'error' }] }),
      ['tool: search_notes'],
    ],
    ['forbidden text', run({ text: 'Cumin [note-06], invented' }), ['not contains /invented/i']],
    [
      'an answer that is too long',
      run({ text: `Cumin [note-06] ${'x'.repeat(60)}` }),
      ['at most 40 characters'],
    ],
    ['a missing phrase', run({ text: 'Spices [note-06]' }), ['contains "cumin"']],
    [
      'a citation the search never returned',
      run({ tools: [{ input: { query: 'lentil' }, output: '{"matches":[{"id":"note-02"}]}' }] }),
      ['cites note-06'],
    ],
    ['no citation', run({ text: 'Cumin' }), ['cites note-06']],
  ])('fail %s', (_name, result, expected) => {
    expect(failures(result)).toEqual(expected);
  });
});

describe('the document checks catch citations that do not hold up', () => {
  const documentCase: EvalCase = {
    id: 'docs',
    prompt: 'p',
    documents: { ids: ['refund-policy', 'travel-handbook'], via: 'model' },
    expect: { tools: [], citations: { documents: ['refund-policy'] }, answer: {} },
  };
  const text = fixture('refund-policy').text;
  const quote = 'Customers can return any product within 30 days of delivery for a full refund.';
  const start = text.indexOf(quote);
  const good: Citation = {
    documentId: 'refund-policy',
    documentName: 'refund-policy.txt',
    quote,
    start,
    end: start + quote.length,
  };

  function documentFailures(citations: Citation[]) {
    const result = { ...run({ tools: [] }), citations };
    return evaluateCase(documentCase, result)
      .filter((check) => !check.passed)
      .map((check) => check.name);
  }

  it('pass a citation whose range holds exactly the quote', () => {
    expect(documentFailures([good])).toEqual([]);
  });

  it.each<[string, Citation[], string[]]>([
    [
      'a range past the end of the document',
      [{ ...good, end: text.length + 5 }],
      ['every citation points inside its document'],
    ],
    [
      'a quote that differs from the text at its range',
      [{ ...good, start: start + 1, end: start + 1 + quote.length }],
      ['every quote matches the source at its range'],
    ],
    [
      'a document that was not supplied',
      [{ ...good, documentId: 'other' }],
      ['every citation points inside its document', 'cites refund-policy.txt'],
    ],
    [
      'a page the PDF does not have',
      [
        good,
        {
          documentId: 'travel-handbook',
          documentName: 'travel-handbook.pdf',
          quote: 'x',
          startPage: 9,
          endPage: 9,
        },
      ],
      ['every citation points inside its document'],
    ],
    [
      'a PDF quote that is not on the cited page',
      [
        good,
        {
          documentId: 'travel-handbook',
          documentName: 'travel-handbook.pdf',
          quote: 'Meals are reimbursed',
          startPage: 1,
          endPage: 1,
        },
      ],
      ['every quote matches the source at its range'],
    ],
    ['no citations at all', [], ['cites something', 'cites refund-policy.txt']],
  ])('fail %s', (_name, citations, expected) => {
    expect(documentFailures(citations)).toEqual(expected);
  });
});
