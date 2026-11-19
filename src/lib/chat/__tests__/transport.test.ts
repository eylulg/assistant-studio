import { afterEach, describe, expect, it, vi } from 'vitest';
import { textDocument } from '@/test-utils/documents';
import { collect } from '@/test-utils/model';
import { type ChatRequest, RESUME_PROMPT, type StreamEvent } from '../../protocol';
import { toSseStream } from '../../sse';
import { createTransport } from '../transport';

const refunds = textDocument(
  'd1',
  'refunds.txt',
  'Customers can return any product within 30 days of delivery for a full refund.',
);

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'user', content: 'How many days do customers have to return a product?' }],
    tasks: [],
    documents: [],
    ...overrides,
  };
}

function stubFetch() {
  const fetchMock = vi.fn(async (..._args: unknown[]) => {
    const events: StreamEvent[] = [
      { type: 'round_start' },
      { type: 'text', text: 'From the server.' },
      { type: 'done', reason: 'end_turn' },
    ];
    return new Response(
      toSseStream(
        (async function* () {
          for (const event of events) yield event;
        })(),
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createTransport', () => {
  it('answers a question about documents in the browser in demo mode, so nothing is sent anywhere', async () => {
    const fetchMock = stubFetch();

    const events = await collect(
      await createTransport({ demo: true })(request(), new AbortController().signal, [refunds]),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(events[0]).toEqual({ type: 'answer_mode', mode: 'extractive' });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'citation',
        citation: expect.objectContaining({ documentId: 'd1' }),
      }),
    );
  });

  it('sends the documents with the question in live mode, as text for a text file and base64 for a PDF', async () => {
    const fetchMock = stubFetch();
    const pdf = textDocument('d2', 'report.pdf', 'Page text', {
      kind: 'pdf',
      bytes: new TextEncoder().encode('%PDF-1.4').buffer as ArrayBuffer,
    });

    await collect(
      await createTransport({ demo: false })(request(), new AbortController().signal, [
        refunds,
        pdf,
      ]),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      documents: [
        { kind: 'text', id: 'd1', name: 'refunds.txt', text: refunds.text },
        { kind: 'pdf', id: 'd2', name: 'report.pdf', data: btoa('%PDF-1.4') },
      ],
    });
  });

  it.each([
    ['there are no documents', request(), []],
    [
      'the turn continues after a tool result',
      request({
        messages: [
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] },
        ],
      }),
      [refunds],
    ],
    [
      'the turn is a resume',
      request({ resume: true, messages: [{ role: 'user', content: RESUME_PROMPT }] }),
      [refunds],
    ],
  ])('asks the server in demo mode when %s', async (_name, chatRequest, documents) => {
    const fetchMock = stubFetch();

    const events = await collect(
      await createTransport({ demo: true })(chatRequest, new AbortController().signal, documents),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: 'text', text: 'From the server.' });
    expect(
      JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)).documents,
    ).toEqual([]);
  });
});
