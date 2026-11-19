import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { composeExtractiveAnswer } from '@/lib/documents/answer';
import { Markdown } from '../markdown';

describe('an extractive quote in the Markdown renderer', () => {
  it('shows list markers, entities and indentation as written, not as a list, a character or code', () => {
    const text = [
      'Taxis are covered',
      '- Taxis to the airport',
      '1) Submit receipts',
      'R&amp;D costs',
      '    indented line',
      '=== done',
    ].join('\n');
    const answer = composeExtractiveAnswer('taxis receipts', [{ id: 'd', name: 'policy.md', text }])
      .flatMap((piece) => (piece.type === 'text' ? [piece.text] : []))
      .join('');

    const { container } = render(<Markdown>{answer}</Markdown>);

    const quote = container.querySelector('blockquote');
    expect(quote?.querySelector('ul, ol, pre, h1, h2')).toBeNull();
    expect(quote?.textContent?.replace(/ /g, ' ').trim()).toBe(text);
  });
});
