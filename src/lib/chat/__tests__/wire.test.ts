import { describe, expect, it } from 'vitest';
import { DENIED_RESULT, RESUME_PROMPT, type StreamEvent, type WireMessage } from '../../protocol';
import { applyStreamEvent, interruptMessage, newAssistantMessage } from '../reducer';
import type { AssistantMessage, Message, UserMessage } from '../types';
import { toWireMessages } from '../wire';

const user = (id: string, text: string): UserMessage => ({
  role: 'user',
  id,
  text,
  createdAt: 't',
});

function assistant(events: StreamEvent[], id = 'a1'): AssistantMessage {
  return events.reduce(applyStreamEvent, newAssistantMessage(id, 'claude-sonnet-5-5', 't'));
}

const thinking = { type: 'thinking' as const, thinking: '', signature: 'sig' };

const searchRound: StreamEvent[] = [
  { type: 'round_start' },
  { type: 'reasoning', block: thinking },
  { type: 'text', text: 'Checking.' },
  { type: 'tool_start', id: 't1', name: 'calculate' },
  { type: 'tool_call', id: 't1', name: 'calculate', input: { expression: '1+1' } },
  { type: 'tool_result', id: 't1', ok: true, output: '{"result":2}', durationMs: 1 },
];

function roles(wire: WireMessage[]): string[] {
  return wire.map((message) => message.role);
}

describe('toWireMessages', () => {
  it('sends each round as an assistant turn followed by its tool results, in one user turn for parallel calls', () => {
    const message = assistant([
      { type: 'round_start' },
      { type: 'tool_start', id: 't1', name: 'lookup_weather' },
      { type: 'tool_call', id: 't1', name: 'lookup_weather', input: { city: 'Oslo' } },
      { type: 'tool_start', id: 't2', name: 'lookup_weather' },
      { type: 'tool_call', id: 't2', name: 'lookup_weather', input: { city: 'Lisbon' } },
      { type: 'tool_result', id: 't2', ok: true, output: 'lisbon', durationMs: 1 },
      { type: 'tool_result', id: 't1', ok: true, output: 'oslo', durationMs: 1 },
      { type: 'round_start' },
      { type: 'text', text: 'Both are sample data.' },
    ]);

    const wire = toWireMessages([user('u1', 'Weather?'), message]);

    expect(wire).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Weather?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'lookup_weather', input: { city: 'Oslo' } },
          { type: 'tool_use', id: 't2', name: 'lookup_weather', input: { city: 'Lisbon' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'oslo' },
          { type: 'tool_result', tool_use_id: 't2', content: 'lisbon' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Both are sample data.' }] },
    ]);
  });

  it.each([
    ['denied', 'denied' as const, { content: DENIED_RESULT, is_error: true }],
    ['failed', 'error' as const, { content: 'Unknown unit', is_error: true }],
  ])('reports a %s tool to the model as an error result', (_name, status, expected) => {
    const message = assistant([
      { type: 'round_start' },
      { type: 'tool_start', id: 't1', name: 'create_task' },
      { type: 'tool_pending', id: 't1', name: 'create_task', input: { title: 'x' } },
    ]);
    const resolved: AssistantMessage = {
      ...message,
      parts: message.parts.map((part) =>
        part.type === 'tool'
          ? {
              ...part,
              status,
              output: status === 'error' ? 'Unknown unit' : 'The user denied this action.',
            }
          : part,
      ),
    };

    const wire = toWireMessages([user('u1', 'Add it'), resolved]);

    expect(wire.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', ...expected }],
    });
  });

  it('answers a call that never finished with an error result, so the history stays valid', () => {
    const message = assistant([
      { type: 'round_start' },
      { type: 'tool_start', id: 't1', name: 'lookup_weather' },
      { type: 'tool_call', id: 't1', name: 'lookup_weather', input: { city: 'Oslo' } },
    ]);

    const wire = toWireMessages([
      user('u1', 'Weather?'),
      {
        ...message,
        status: 'stopped',
        parts: message.parts.map((part) =>
          part.type === 'tool' ? { ...part, status: 'cancelled' as const } : part,
        ),
      },
    ]);

    expect(wire.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }],
    });
  });

  it('leaves out a tool call whose input never finished streaming', () => {
    const message = assistant([
      { type: 'round_start' },
      { type: 'text', text: 'Let me' },
      { type: 'tool_start', id: 't1', name: 'calculate' },
      { type: 'tool_input', id: 't1', delta: '{"expr' },
    ]);

    const wire = toWireMessages([user('u1', 'Add'), interruptMessage(message)]);

    expect(wire).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Add' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Let me' }] },
    ]);
  });

  it('returns reasoning blocks only for the answer still in progress', () => {
    const earlier = assistant(
      [...searchRound, { type: 'round_start' }, { type: 'text', text: 'It is 2.' }],
      'a1',
    );
    const current = assistant(searchRound, 'a2');
    const path: Message[] = [user('u1', '1+1?'), earlier, user('u2', 'Again'), current];

    const blocks = toWireMessages(path).flatMap((message) =>
      message.role === 'assistant' ? message.content : [],
    );
    const reasoning = blocks.filter((block) => block.type === 'thinking');

    expect(reasoning).toHaveLength(1);
    expect(blocks.findIndex((block) => block.type === 'thinking')).toBe(blocks.length - 3);
  });

  it('ends a pending resume with the request to continue, after the partial answer', () => {
    const partial = interruptMessage(
      assistant([{ type: 'round_start' }, { type: 'text', text: 'First half' }]),
    );

    const wire = toWireMessages([
      user('u1', 'Explain'),
      { ...partial, status: 'streaming', resumes: [partial.rounds] },
    ]);

    expect(roles(wire)).toEqual(['user', 'assistant', 'user']);
    expect(wire.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: RESUME_PROMPT }] });
  });

  it('keeps the request to continue between the partial answer and its continuation on later turns', () => {
    const partial = interruptMessage(
      assistant([{ type: 'round_start' }, { type: 'text', text: 'First half' }]),
    );
    const resumed = applyStreamEvent(
      applyStreamEvent(
        { ...partial, status: 'streaming', resumes: [partial.rounds] },
        { type: 'round_start' },
      ),
      {
        type: 'text',
        text: 'second half',
      },
    );

    const wire = toWireMessages([user('u1', 'Explain'), resumed]);

    expect(
      wire.map((message) => (message.role === 'assistant' ? message.content : message.content)),
    ).toEqual([
      [{ type: 'text', text: 'Explain' }],
      [{ type: 'text', text: 'First half' }],
      [{ type: 'text', text: RESUME_PROMPT }],
      [{ type: 'text', text: 'second half' }],
    ]);
  });
});
