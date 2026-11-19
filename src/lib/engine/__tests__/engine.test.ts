import { describe, expect, it } from 'vitest';
import { collect, scriptedClient, textRound, toolRound, types, usage } from '@/test-utils/model';
import type { ModelEvent, StreamEvent, WireMessage } from '../../protocol';
import { type EngineOptions, runChat } from '../engine';
import { type ModelClient, UpstreamInterrupted } from '../model-client';

const NOW = new Date('2026-11-10T09:30:00.000Z');
const question: WireMessage[] = [{ role: 'user', content: 'Help' }];

function options(overrides: Partial<EngineOptions> = {}): EngineOptions {
  return {
    model: 'claude-sonnet-5-5',
    system: 'system',
    messages: question,
    tasks: [],
    resume: false,
    maxRounds: 5,
    maxOutputTokens: 4096,
    context: { now: () => NOW, clock: 'frozen', simulateLatency: false },
    ...overrides,
  };
}

function resultsOf(events: StreamEvent[]) {
  return events.flatMap((event) =>
    event.type === 'tool_result' ? [{ id: event.id, ok: event.ok, output: event.output }] : [],
  );
}

describe('runChat, phase one: the model asks for tools', () => {
  it('runs tools without side effects at once and feeds the results to the next round', async () => {
    const client = scriptedClient([
      toolRound([{ id: 't1', name: 'calculate', input: { expression: '2+2' } }], 'Checking.'),
      textRound('It is 4.'),
    ]);

    const events = await collect(runChat(options(), client));

    expect(types(events)).toEqual([
      'round_start',
      'text',
      'tool_start',
      'tool_input',
      'usage',
      'tool_call',
      'tool_result',
      'round_start',
      'text',
      'usage',
      'done',
    ]);
    expect(resultsOf(events)).toEqual([
      { id: 't1', ok: true, output: '{"expression":"2+2","result":4}' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'end_turn' });
    expect(client.requests[1]?.messages.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 't1', name: 'calculate', input: { expression: '2+2' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"expression":"2+2","result":4}' },
        ],
      },
    ]);
  });

  it('runs parallel calls together and returns every result in one user turn, in the order the model asked', async () => {
    const client = scriptedClient([
      toolRound([
        { id: 't1', name: 'get_time', input: { timezone: 'Asia/Tokyo' } },
        { id: 't2', name: 'calculate', input: { expression: '1+1' } },
      ]),
      textRound('Done.'),
    ]);

    const events = await collect(runChat(options(), client));

    expect(
      resultsOf(events)
        .map((result) => result.id)
        .sort(),
    ).toEqual(['t1', 't2']);
    const results = client.requests[1]?.messages.at(-1);
    expect(
      results?.role === 'user' &&
        Array.isArray(results.content) &&
        results.content.map((block) => block.type === 'tool_result' && block.tool_use_id),
    ).toEqual(['t1', 't2']);
  });

  it('tells the model about invalid input and unknown tools instead of running them', async () => {
    const client = scriptedClient([
      toolRound([
        { id: 't1', name: 'calculate', input: { expression: 42 } },
        { id: 't2', name: 'delete_everything', input: {} },
      ]),
      textRound('Sorry.'),
    ]);

    const events = await collect(runChat(options(), client));

    expect(resultsOf(events)).toEqual([
      { id: 't1', ok: false, output: expect.stringContaining('Invalid input for calculate') },
      { id: 't2', ok: false, output: 'Unknown tool "delete_everything".' },
    ]);
    expect(types(events)).not.toContain('tool_call');
    const sent = client.requests[1]?.messages.at(-1);
    expect(
      sent?.role === 'user' &&
        Array.isArray(sent.content) &&
        sent.content.every((block) => block.type === 'tool_result' && block.is_error),
    ).toBe(true);
  });

  it('hands a tool failure to the model as an error result it can recover from', async () => {
    const client = scriptedClient([
      toolRound([{ id: 't1', name: 'convert_units', input: { value: 3, from: 'km', to: 'cups' } }]),
      textRound('Those do not match.'),
    ]);

    const events = await collect(runChat(options(), client));

    expect(resultsOf(events)).toEqual([
      { id: 't1', ok: false, output: 'Cannot convert length (km) to volume (cup).' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'end_turn' });
  });

  it('does not run a tool call the token limit cut off', async () => {
    const client = scriptedClient([
      toolRound(
        [{ id: 't1', name: 'calculate', input: { expression: '1+1' } }],
        undefined,
        'max_tokens',
      ),
    ]);

    const events = await collect(runChat(options(), client));

    expect(types(events)).not.toContain('tool_call');
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'max_tokens' });
  });

  it.each([
    ['a refusal', 'refusal', 'refusal'],
    ['running out of tokens', 'max_tokens', 'max_tokens'],
  ])('ends with the reason for %s', async (_name, stopReason, reason) => {
    const events = await collect(
      runChat(
        options(),
        scriptedClient([[{ type: 'end', stopReason, usage: usage(), content: [] }]]),
      ),
    );

    expect(events.at(-1)).toEqual({ type: 'done', reason });
  });
});

describe('runChat, the approval pause', () => {
  const create = { id: 't2', name: 'create_task', input: { title: 'Renew passport' } };

  it('never runs a side-effect tool: it reports it as pending and stops with awaiting_approval', async () => {
    const client = scriptedClient([
      toolRound([{ id: 't1', name: 'calculate', input: { expression: '1+1' } }, create]),
      textRound('not reached'),
    ]);

    const events = await collect(runChat(options(), client));

    expect(events.filter((event) => event.type === 'tool_pending')).toEqual([
      { type: 'tool_pending', id: 't2', name: 'create_task', input: { title: 'Renew passport' } },
    ]);
    expect(resultsOf(events).map((result) => result.id)).toEqual(['t1']);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'awaiting_approval' });
    expect(client.requests).toHaveLength(1);
  });

  it('does not pause for a side-effect call whose input is invalid, it reports the error to the model', async () => {
    const client = scriptedClient([
      toolRound([{ id: 't2', name: 'create_task', input: { title: '' } }]),
      textRound('Let me fix that.'),
    ]);

    const events = await collect(runChat(options(), client));

    expect(types(events)).not.toContain('tool_pending');
    expect(resultsOf(events)[0]).toMatchObject({ ok: false });
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'end_turn' });
  });

  it("continues in a second request that carries the user's decision as a tool result, with no server state in between", async () => {
    const history: WireMessage[] = [
      ...question,
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't2', name: 'create_task', input: { title: 'Renew passport' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't2', content: '{"created":{"id":"task-1"}}' },
        ],
      },
    ];
    const client = scriptedClient([textRound('Added.')]);

    const events = await collect(runChat(options({ messages: history }), client));

    expect(client.requests[0]?.messages).toEqual(history);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'end_turn' });
  });

  it('lists the tasks the client sent, so list_tasks sees data the server does not hold', async () => {
    const tasks = [
      {
        id: 'task-1',
        title: 'Renew passport',
        priority: 'high' as const,
        done: false,
        createdAt: 't',
      },
    ];
    const client = scriptedClient([
      toolRound([{ id: 't1', name: 'list_tasks', input: {} }]),
      textRound('One task.'),
    ]);

    const events = await collect(runChat(options({ tasks }), client));

    expect(resultsOf(events)[0]?.output).toContain('Renew passport');
  });
});

describe('runChat, limits and failures', () => {
  it('stops after the allowed number of rounds', async () => {
    const loop = toolRound([{ id: 't1', name: 'calculate', input: { expression: '1+1' } }]);
    const client = scriptedClient([loop, loop, loop]);

    const events = await collect(runChat(options({ maxRounds: 2 }), client));

    expect(client.requests).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'max_rounds' });
  });

  it('gives each round only the output tokens left in the request budget, and stops when too few remain', async () => {
    const spend: ModelEvent[] = [
      { type: 'tool_start', id: 't1', name: 'calculate' },
      {
        type: 'end',
        stopReason: 'tool_use',
        usage: { ...usage(), outputTokens: 3900 },
        content: [{ type: 'tool_use', id: 't1', name: 'calculate', input: { expression: '1+1' } }],
      },
    ];
    const client = scriptedClient([spend, textRound('never')]);

    const events = await collect(runChat(options({ maxOutputTokens: 4096 }), client));

    expect(client.requests[0]?.maxTokens).toBe(4096);
    expect(client.requests).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: 'done', reason: 'budget' });
  });

  it('reports a dropped model connection as an interruption, not an error', async () => {
    const client: ModelClient = {
      async *streamRound() {
        yield { type: 'text', text: 'Half an ans' };
        throw new UpstreamInterrupted('The connection to the model dropped.');
      },
    };

    const events = await collect(runChat(options(), client));

    expect(events.at(-1)).toEqual({
      type: 'interrupted',
      reason: 'The connection to the model dropped.',
    });
    expect(types(events)).not.toContain('error');
  });

  it('treats a round that ends without its final event as an interruption', async () => {
    const events = await collect(
      runChat(options(), scriptedClient([[{ type: 'text', text: 'Half' }]])),
    );

    expect(events.at(-1)).toMatchObject({ type: 'interrupted' });
  });

  it('stops quietly, with no more events, when the client goes away while a tool is running', async () => {
    const controller = new AbortController();
    const client = scriptedClient([
      toolRound([{ id: 't1', name: 'lookup_weather', input: { city: 'Oslo' } }]),
      textRound('never'),
    ]);
    const stream = runChat(
      options({
        context: { now: () => NOW, clock: 'frozen', simulateLatency: true },
        signal: controller.signal,
      }),
      client,
    );

    const seen: StreamEvent[] = [];
    for await (const event of stream) {
      seen.push(event);
      if (event.type === 'tool_call') controller.abort();
    }

    expect(types(seen)).not.toContain('tool_result');
    expect(client.requests).toHaveLength(1);
  });

  describe('runChat, documents', () => {
    const documents = [
      { kind: 'text' as const, id: 'doc-a', name: 'notes.txt', text: 'Alpha' },
      { kind: 'pdf' as const, id: 'doc-b', name: 'report.pdf', data: 'JVBERg==' },
    ];

    it("hands the documents to the model and names a citation's document by the id the browser stored it under", async () => {
      const round: ModelEvent[] = [
        { type: 'text', text: 'Covered.' },
        {
          type: 'citation',
          documentIndex: 1,
          citation: { quote: 'Meals', startPage: 4, endPage: 4 },
        },
        {
          type: 'end',
          stopReason: 'end_turn',
          usage: usage(),
          content: [{ type: 'text', text: 'Covered.' }],
        },
      ];
      const client = scriptedClient([round]);

      const events = await collect(runChat(options({ documents }), client));

      expect(client.requests[0]?.documents).toBe(documents);
      expect(events).toContainEqual({
        type: 'citation',
        citation: {
          documentId: 'doc-b',
          documentName: 'report.pdf',
          quote: 'Meals',
          startPage: 4,
          endPage: 4,
        },
      });
    });

    it('drops a citation to a document that was not sent instead of inventing a source', async () => {
      const round: ModelEvent[] = [
        { type: 'citation', documentIndex: 5, citation: { quote: 'x', start: 0, end: 1 } },
        { type: 'end', stopReason: 'end_turn', usage: usage(), content: [] },
      ];

      const events = await collect(runChat(options({ documents }), scriptedClient([round])));

      expect(types(events)).not.toContain('citation');
    });
  });
});
