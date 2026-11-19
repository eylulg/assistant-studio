import { describe, expect, it } from 'vitest';
import { findQuote, locateCitation } from '../locate';

const text =
  'Intro line.\n\nMeals are reimbursed\nup to 40 euros per day.\n\nReceipts within 14 days.';

describe('findQuote', () => {
  it('finds a quote across line breaks and extra spaces and maps it back to offsets in the original text', () => {
    const found = findQuote(text, 'Meals are  reimbursed up to 40 euros per day.');

    expect(found).not.toBeNull();
    expect(text.slice(found?.start, found?.end)).toBe(
      'Meals are reimbursed\nup to 40 euros per day.',
    );
  });

  it('searches only inside the given range', () => {
    expect(findQuote(text, 'Intro line.', 20)).toBeNull();
  });

  it('matches a long quote by its beginning when the rest differs', () => {
    const long =
      'Meals are reimbursed up to 40 euros per day. Receipts within 14 days, which is different wording';

    const found = findQuote(text, long);

    expect(found?.start).toBe(text.indexOf('Meals'));
  });

  it('returns null for text that is not there', () => {
    expect(findQuote(text, 'Business class')).toBeNull();
    expect(findQuote(text, '   ')).toBeNull();
  });
});

describe('locateCitation', () => {
  const pages = [
    { page: 1, start: 0, end: 11 },
    { page: 2, start: 13, end: text.length },
  ];

  it('uses a character range as given when it fits the text', () => {
    expect(
      locateCitation({ text, pages: undefined }, { quote: 'Intro', start: 0, end: 5 }),
    ).toEqual({ start: 0, end: 5 });
  });

  it('reads a range counted in characters when an emoji comes before the quote, and ignores a range that does not match the quote', () => {
    const emoji = 'Launch \u{1F680}\u{1F680} is on Friday. Review is on Monday.';
    const quote = 'Review is on Monday.';
    const inCharacters = emoji.indexOf(quote) - 2;

    const counted = locateCitation(
      { text: emoji, pages: undefined },
      { quote, start: inCharacters, end: inCharacters + quote.length },
    );
    const wrong = locateCitation(
      { text: emoji, pages: undefined },
      { quote, start: 0, end: quote.length },
    );

    expect(emoji.slice(counted?.start, counted?.end)).toBe(quote);
    expect(emoji.slice(wrong?.start, wrong?.end)).toBe(quote);
  });

  it('looks for a PDF quote on the cited page and ignores the same words on another page', () => {
    const repeated = 'Total due. Intro.\n\nTotal due. Later.';
    const spans = [
      { page: 1, start: 0, end: 17 },
      { page: 2, start: 19, end: repeated.length },
    ];

    const found = locateCitation(
      { text: repeated, pages: spans },
      { quote: 'Total due.', startPage: 2, endPage: 2 },
    );

    expect(found).toEqual({ start: 19, end: 29 });
  });

  it('finds a quote on a page range', () => {
    const found = locateCitation(
      { text, pages },
      { quote: 'Receipts within 14 days.', startPage: 1, endPage: 2 },
    );

    expect(text.slice(found?.start, found?.end)).toBe('Receipts within 14 days.');
  });

  it.each([
    ['a range past the end of the text', { quote: 'Intro line.', start: 5, end: 9999 }],
    ['a range that is not the quoted text', { quote: 'Intro line.', start: 20, end: 30 }],
    ['an empty range', { quote: 'Intro line.', start: 5, end: 5 }],
  ])('falls back to searching for the quote when it is given %s', (_name, citation) => {
    expect(locateCitation({ text, pages: undefined }, citation)?.start).toBe(0);
  });

  it('returns null when the quote is not on the cited page', () => {
    expect(
      locateCitation(
        { text, pages },
        { quote: 'Receipts within 14 days.', startPage: 1, endPage: 1 },
      ),
    ).toBeNull();
  });
});
