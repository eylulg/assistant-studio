import { describe, expect, it } from 'vitest';
import { MAX_DOCUMENTS, MAX_TOTAL_CHARS } from '@/lib/documents/limits';
import { memoryRepository, textDocument } from '@/test-utils/documents';
import { createDocumentsStore } from '../documents-store';

function setup(
  options: {
    readPdf?: (bytes: ArrayBuffer) => Promise<string[]>;
    repository?: ReturnType<typeof memoryRepository>;
  } = {},
) {
  let counter = 0;
  const repository = options.repository ?? memoryRepository();
  const store = createDocumentsStore({
    repository,
    newId: () => `d${(counter += 1)}`,
    now: () => new Date('2026-11-10T09:30:00.000Z'),
    readPdf: options.readPdf,
  });
  return { store, repository, entries: (id = 'c1') => store.getState().entries[id] ?? [] };
}

const txt = (name: string, content: string) => new File([content], name);

describe('documents store', () => {
  it('shows a file as reading, then ready with its text, and keeps it in storage for the conversation', async () => {
    const { store, repository, entries } = setup();

    const adding = store.getState().add('c1', [txt('a.txt', 'Alpha text')]);
    expect(entries()).toMatchObject([{ name: 'a.txt', status: 'reading' }]);
    await adding;

    expect(entries()).toMatchObject([
      { name: 'a.txt', status: 'ready', enabled: true, text: 'Alpha text' },
    ]);
    expect(repository.all()).toMatchObject([
      { conversationId: 'c1', name: 'a.txt', text: 'Alpha text' },
    ]);
  });

  it('keeps a failed file in the list with its reason, and lets only a failure that can change be retried', async () => {
    let attempts = 0;
    const { store, entries } = setup({
      readPdf: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('worker crashed');
        return ['Recovered text'];
      },
    });
    const docx = txt('notes.docx', 'x');
    const pdf = new File(['%PDF-1.4'], 'flaky.pdf');

    await store.getState().add('c1', [docx, pdf]);

    expect(entries()).toMatchObject([
      {
        name: 'notes.docx',
        status: 'failed',
        retryable: false,
        error: expect.stringContaining('.txt, .md or .pdf'),
      },
      { name: 'flaky.pdf', status: 'failed', retryable: true },
    ]);

    await store.getState().retry('c1', entries()[1]?.id ?? '');

    expect(entries()[1]).toMatchObject({
      status: 'ready',
      error: undefined,
      text: 'Recovered text',
    });
    await store.getState().retry('c1', entries()[0]?.id ?? '');
    expect(entries()[0]?.status).toBe('failed');
  });

  it('reads one file at a time', async () => {
    let active = 0;
    let most = 0;
    const { store } = setup({
      readPdf: async () => {
        active += 1;
        most = Math.max(most, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return ['text'];
      },
    });

    await store
      .getState()
      .add('c1', [
        new File(['%PDF-1.4'], 'a.pdf'),
        new File(['%PDF-1.4'], 'b.pdf'),
        new File(['%PDF-1.4'], 'c.pdf'),
      ]);

    expect(most).toBe(1);
  });

  it('does not save a document that was removed while it was waiting or being read, so it is gone after a reload', async () => {
    let release: () => void = () => {};
    const { store, repository, entries } = setup({
      readPdf: () =>
        new Promise((resolve) => {
          release = () => resolve(['Slow text']);
        }),
    });

    const adding = store
      .getState()
      .add('c1', [new File(['%PDF-1.4'], 'slow.pdf'), txt('second.txt', 'Second text')]);
    const [pdf, second] = entries();
    await store.getState().remove('c1', second?.id ?? '');
    await store.getState().remove('c1', pdf?.id ?? '');
    release();
    await adding;
    await store.getState().load('c1');

    expect(repository.all()).toEqual([]);
    expect(entries()).toEqual([]);
  });

  it('refuses a PDF that would pass the page limit of the conversation, counting pages with no text', async () => {
    const { store, entries } = setup({
      readPdf: async () => Array.from({ length: 400 }, (_, index) => (index === 0 ? 'Text' : '')),
    });

    await store
      .getState()
      .add('c1', [new File(['%PDF-1.4'], 'a.pdf'), new File(['%PDF-1.4'], 'b.pdf')]);

    expect(entries()[0]).toMatchObject({ status: 'ready', pageCount: 400 });
    expect(entries()[1]).toMatchObject({
      status: 'failed',
      retryable: false,
      error: expect.stringContaining('PDF pages per conversation'),
    });
  });

  it('refuses a file that would pass the text limit or the document count, with a reason', async () => {
    const { store, entries } = setup({ repository: memoryRepository() });
    await store.getState().add('c1', [txt('big.txt', 'x'.repeat(MAX_TOTAL_CHARS - 10))]);

    await store.getState().add('c1', [txt('more.txt', 'y'.repeat(50))]);

    expect(entries()[1]).toMatchObject({
      status: 'failed',
      retryable: false,
      error: expect.stringContaining('characters of text per conversation'),
    });

    const many = setup();
    await many.store.getState().add(
      'c1',
      Array.from({ length: MAX_DOCUMENTS + 1 }, (_, index) => txt(`f${index}.txt`, `doc ${index}`)),
    );
    expect(many.entries().filter((entry) => entry.status === 'ready')).toHaveLength(MAX_DOCUMENTS);
    expect(many.entries().at(-1)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining(`${MAX_DOCUMENTS} documents`),
    });
  });

  it('reports a file it could not save as failed, and retryable', async () => {
    const repository = memoryRepository();
    repository.put = async () => {
      throw new Error('quota');
    };
    const { store, entries } = setup({ repository });

    await store.getState().add('c1', [txt('a.txt', 'Alpha')]);

    expect(entries()[0]).toMatchObject({
      status: 'failed',
      retryable: true,
      error: expect.stringContaining('saved in this browser'),
    });
  });

  it('gives the next question only documents that are ready and switched on, in the order they were added', async () => {
    const { store } = setup();
    await store
      .getState()
      .add('c1', [
        txt('a.txt', 'Alpha'),
        txt('b.txt', 'Bravo'),
        txt('c.txt', 'Charlie'),
        txt('d.docx', 'x'),
      ]);
    const second = store.getState().entries['c1']?.[1]?.id ?? '';

    await store.getState().setEnabled('c1', second, false);
    const used = await store.getState().forQuestion('c1');

    expect(used.map((document) => document.name)).toEqual(['a.txt', 'c.txt']);
    expect(await store.getState().forQuestion('other')).toEqual([]);
  });

  it('hands over the text without reading storage unless the original files are asked for, and an answer can name the documents it was started with', async () => {
    const repository = memoryRepository();
    const { store } = setup({ repository });
    await store.getState().add('c1', [txt('a.txt', 'Alpha'), txt('b.txt', 'Bravo')]);
    const [first, second] = store.getState().entries['c1'] ?? [];
    await store.getState().setEnabled('c1', second?.id ?? '', false);
    repository.list = async () => {
      throw new Error('storage must not be read');
    };

    const switchedOn = await store.getState().forQuestion('c1', { withBytes: false });
    const named = await store
      .getState()
      .forQuestion('c1', { only: [second?.id ?? ''], withBytes: false });

    expect(switchedOn.map((document) => document.id)).toEqual([first?.id]);
    expect(named).toMatchObject([{ id: second?.id, text: 'Bravo' }]);
  });

  it('keeps documents per conversation: loading restores them with their switch, and deleting a conversation removes its documents', async () => {
    const repository = memoryRepository([
      textDocument('x1', 'kept.txt', 'Kept', { enabled: false }),
      textDocument('x2', 'elsewhere.txt', 'Elsewhere', { conversationId: 'c2' }),
    ]);
    const { store, entries } = setup({ repository });

    await store.getState().load('c1');

    expect(entries()).toMatchObject([{ id: 'x1', status: 'ready', enabled: false, text: 'Kept' }]);
    expect(store.getState().entries['c2']).toBeUndefined();

    await store.getState().removeConversation('c1');

    expect(repository.all().map((document) => document.id)).toEqual(['x2']);
    expect(entries()).toEqual([]);
  });

  it('deletes stored documents of conversations that are gone, but not recent ones or the ones kept', async () => {
    const repository = memoryRepository([
      textDocument('x1', 'kept.txt', 'Kept', { conversationId: 'c1' }),
      textDocument('x2', 'trimmed.txt', 'Trimmed', {
        conversationId: 'gone',
        createdAt: '2026-11-01T09:30:00.000Z',
      }),
      textDocument('x3', 'fresh.txt', 'Fresh', {
        conversationId: 'other-tab',
        createdAt: '2026-11-10T09:00:00.000Z',
      }),
    ]);
    const { store } = setup({ repository });

    await store.getState().prune(['c1']);

    expect(repository.all().map((document) => document.id)).toEqual(['x1', 'x3']);
  });

  it("does not lose a file added while the conversation's documents were still loading", async () => {
    const repository = memoryRepository();
    const list = repository.list;
    let release: () => void = () => {};
    repository.list = async (conversationId) => {
      const stored = await list(conversationId);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return stored;
    };
    const { store, entries } = setup({ repository });

    const loading = store.getState().load('c1');
    await store.getState().add('c1', [txt('a.txt', 'Alpha')]);
    release();
    await loading;

    expect(entries()).toMatchObject([{ name: 'a.txt', status: 'ready' }]);
  });

  it('says storage is unavailable when it cannot be read, so documents are not offered', async () => {
    const repository = memoryRepository();
    repository.list = async () => {
      throw new Error('blocked');
    };
    const { store } = setup({ repository });

    await store.getState().load('c1');

    expect(store.getState().storage).toBe('unavailable');
  });

  it('removes a document from the list and from storage', async () => {
    const { store, repository, entries } = setup();
    await store.getState().add('c1', [txt('a.txt', 'Alpha')]);

    await store.getState().remove('c1', entries()[0]?.id ?? '');

    expect(entries()).toEqual([]);
    expect(repository.all()).toEqual([]);
  });
});
