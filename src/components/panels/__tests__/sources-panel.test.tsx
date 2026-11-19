import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createDocumentsStore } from '@/store/documents-store';
import { memoryRepository } from '@/test-utils/documents';
import { scriptedTransport, testStore } from '@/test-utils/store';
import { Announcer } from '../../chat/announcer';
import { StudioProvider } from '../../studio-context';
import { SourcesPanel } from '../sources-panel';

async function setup(files: File[], readPdf?: (bytes: ArrayBuffer) => Promise<string[]>) {
  let counter = 0;
  const documents = createDocumentsStore({
    repository: memoryRepository(),
    newId: () => `d${(counter += 1)}`,
    now: () => new Date('2026-11-10T09:30:00.000Z'),
    readPdf,
  });
  const store = testStore(scriptedTransport([]).transport);
  store.getState().newConversation();
  const conversationId = store.getState().activeId ?? '';
  await documents.getState().add(conversationId, files);
  render(
    <StudioProvider store={store} documents={documents} demo focusComposer={() => {}}>
      <SourcesPanel demo />
      <Announcer />
    </StudioProvider>,
  );
  return { documents, conversationId };
}

const txt = (name: string, text = `${name} text`) => new File([text], name);

describe('Sources panel', () => {
  it("moves focus to the next document's Remove button after a removal, then the previous one, then Add documents", async () => {
    const user = userEvent.setup();
    await setup([txt('a.txt'), txt('b.txt'), txt('c.txt')]);

    await user.click(screen.getByRole('button', { name: 'Remove b.txt' }));
    expect(screen.getByRole('button', { name: 'Remove c.txt' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Remove c.txt' }));
    expect(screen.getByRole('button', { name: 'Remove a.txt' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Remove a.txt' }));
    expect(screen.getByRole('button', { name: 'Add documents' })).toHaveFocus();
  });

  it("keeps focus on the file's name when Retry swaps the row to Reading", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    await setup([new File(['%PDF-1.4'], 'flaky.pdf')], async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('worker crashed');
      return ['Recovered'];
    });

    await user.click(screen.getByRole('button', { name: 'Retry flaky.pdf' }));

    expect(screen.getByText('flaky.pdf')).toHaveFocus();
  });

  it('announces what happened to a document, says nothing for the documents a conversation loads with, and names the removed one', async () => {
    const user = userEvent.setup();
    const { documents } = await setup([txt('a.txt'), txt('b.txt')]);
    const regions = screen.getAllByRole('status');
    expect(regions.map((region) => region.textContent)).toEqual(['', 'b.txt is ready.']);

    await user.click(screen.getByRole('button', { name: 'Remove a.txt' }));

    expect(regions[1]).toHaveTextContent('Removed a.txt.');
    await act(() => documents.getState().load('elsewhere'));
    expect(regions[1]).toHaveTextContent('Removed a.txt.');
  });

  it("says how many of a PDF's pages have text", async () => {
    await setup([new File(['%PDF-1.4'], 'report.pdf')], async () => [
      'First page.',
      '',
      'Third page.',
    ]);

    expect(screen.getByText(/in 3 pages, 2 with text/)).toBeVisible();
  });
});
