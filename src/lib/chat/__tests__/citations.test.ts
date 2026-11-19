import { describe, expect, it } from 'vitest';
import type { Citation } from '../../protocol';
import { annotate, citationKey, citationLabel, numberCitations } from '../citations';
import type { Part } from '../types';

const base: Citation = {
  documentId: 'd1',
  documentName: 'report.pdf',
  quote: 'q',
  start: 10,
  end: 20,
};

describe('numberCitations', () => {
  it('numbers sources from 1 in the order they first appear across the answer, and a source cited again keeps its number', () => {
    const parts: Part[] = [
      { type: 'text', round: 0, text: 'a', citations: [{ at: 1, citation: base }] },
      { type: 'tool', round: 0, id: 't', name: 'calculate', status: 'done', rawInput: '' },
      {
        type: 'text',
        round: 1,
        text: 'b',
        citations: [
          { at: 0, citation: { ...base, start: 30, end: 40 } },
          { at: 1, citation: base },
        ],
      },
    ];

    const numbers = numberCitations(parts);

    expect([...numbers.values()]).toEqual([1, 2]);
    expect(numbers.get(citationKey(base))).toBe(1);
  });

  it('tells two PDF quotes on the same page apart, because the model cites by page', () => {
    const first = {
      documentId: 'd1',
      documentName: 'r.pdf',
      quote: 'one',
      startPage: 2,
      endPage: 2,
    };
    const second = { ...first, quote: 'two' };

    expect(citationKey(first)).not.toBe(citationKey(second));
  });
});

describe('citationLabel', () => {
  it.each<[string, Citation, string]>([
    ['a text file', base, 'Source 2: report.pdf'],
    ['one page', { ...base, startPage: 4, endPage: 4 }, 'Source 2: report.pdf, page 4'],
    ['a page range', { ...base, startPage: 4, endPage: 6 }, 'Source 2: report.pdf, pages 4 to 6'],
  ])('names %s', (_name, citation, label) => {
    expect(citationLabel(2, citation)).toBe(label);
  });
});

describe('annotate', () => {
  it('inserts a marker at every position, keeping the order of markers that share one', () => {
    const placed = [
      { at: 5, citation: base },
      { at: 5, citation: base },
      { at: 0, citation: base },
    ];

    expect(annotate('Hello world', placed, (index) => `[${index}]`)).toBe('[2]Hello[0][1] world');
  });

  it('clamps a position past the end of the text', () => {
    expect(annotate('Hi', [{ at: 99, citation: base }], () => '!')).toBe('Hi!');
  });
});
