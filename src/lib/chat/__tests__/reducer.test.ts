import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '../../protocol';
import {
  applyStreamEvent,
  failMessage,
  interruptMessage,
  newAssistantMessage,
  stopMessage,
} from '../reducer';
import type { AssistantMessage, ToolPart } from '../types';

function play(
  events: StreamEvent[],
  from: AssistantMessage = newAssistantMessage(
    'a1',
    'claude-sonnet-5-5',
    '2026-11-10T09:30:00.000Z',
  ),
): AssistantMessage {
  return events.reduce(applyStreamEvent, from);
}

const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 };

function toolParts(message: AssistantMessage): ToolPart[] {
  return message.parts.filter((part): part is ToolPart => part.type === 'tool');
}

describe('applyStreamEvent', () => {
  it('joins text deltas into one part per round and starts a new part for the next round', () => {
    const message = play([
      { type: 'round_start' },
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'round_start' },
      { type: 'text', text: 'Again' },
    ]);

    expect(message.parts).toEqual([
      { type: 'text', round: 0, text: 'Hello' },
      { type: 'text', round: 1, text: 'Again' },
    ]);
    expect(message.rounds).toBe(2);
  });

  it('follows an automatic tool call from the first streamed byte to its result', () => {
    const events: StreamEvent[] = [
      { type: 'round_start' },
      { type: 'tool_start', id: 't1', name: 'calculate' },
      { type: 'tool_input', id: 't1', delta: '{"expression":' },
      { type: 'tool_input', id: 't1', delta: '"1+1"}' },
    ];

    const streaming = toolParts(play(events))[0];
    expect(streaming).toMatchObject({ status: 'streaming', rawInput: '{"expression":"1+1"}' });
    expect(streaming?.input).toBeUndefined();

    const ran = play([
      ...events,
      { type: 'tool_call', id: 't1', name: 'calculate', input: { expression: '1+1' } },
    ]);
    expect(toolParts(ran)[0]).toMatchObject({ status: 'running', input: { expression: '1+1' } });

    const done = play([
      ...events,
      { type: 'tool_call', id: 't1', name: 'calculate', input: { expression: '1+1' } },
      { type: 'tool_result', id: 't1', ok: true, output: '{"result":2}', durationMs: 3 },
    ]);
    expect(toolParts(done)[0]).toMatchObject({
      status: 'done',
      output: '{"result":2}',
      durationMs: 3,
    });
  });

  it('shows a failed tool as failed, and a pending one as waiting for approval', () => {
    const message = play([
      { type: 'round_start' },
      { type: 'tool_start', id: 't1', name: 'convert_units' },
      { type: 'tool_start', id: 't2', name: 'create_task' },
      { type: 'tool_result', id: 't1', ok: false, output: 'Unknown unit', durationMs: 0 },
      { type: 'tool_pending', id: 't2', name: 'create_task', input: { title: 'x' } },
      { type: 'done', reason: 'awaiting_approval' },
    ]);

    expect(toolParts(message).map((part) => part.status)).toEqual(['error', 'awaiting_approval']);
    expect(message.status).toBe('awaiting_approval');
  });

  it('adds up usage over the rounds of one answer', () => {
    const message = play([
      { type: 'round_start' },
      { type: 'usage', usage },
      { type: 'round_start' },
      { type: 'usage', usage },
    ]);

    expect(message.usage).toEqual({
      inputTokens: 200,
      outputTokens: 40,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    });
  });

  it('completes the message on done and cancels a tool call the token limit cut off', () => {
    const message = play([
      { type: 'round_start' },
      { type: 'tool_start', id: 't1', name: 'calculate' },
      { type: 'tool_input', id: 't1', delta: '{"expr' },
      { type: 'done', reason: 'max_tokens' },
    ]);

    expect(message).toMatchObject({ status: 'complete', doneReason: 'max_tokens' });
    expect(toolParts(message)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('ignores a repeated tool_start for the same call', () => {
    const message = play([
      { type: 'tool_start', id: 't1', name: 'calculate' },
      { type: 'tool_start', id: 't1', name: 'calculate' },
    ]);

    expect(toolParts(message)).toHaveLength(1);
  });
});

describe('ending a message early', () => {
  const streaming = play([
    { type: 'round_start' },
    { type: 'text', text: 'Partial answer' },
    { type: 'tool_start', id: 't1', name: 'lookup_weather' },
    { type: 'tool_call', id: 't1', name: 'lookup_weather', input: { city: 'Oslo' } },
  ]);

  it.each([
    ['Stop', stopMessage, 'stopped'],
    ['a dropped connection', interruptMessage, 'interrupted'],
  ])('keeps the partial text and cancels the running tool after %s', (_name, end, status) => {
    const message = end(streaming);

    expect(message.status).toBe(status);
    expect(message.parts[0]).toEqual({ type: 'text', round: 0, text: 'Partial answer' });
    expect(toolParts(message)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('keeps the partial text when the request fails', () => {
    const message = failMessage(streaming, 'The model is busy right now.');

    expect(message).toMatchObject({ status: 'error', error: 'The model is busy right now.' });
    expect(message.parts[0]).toMatchObject({ text: 'Partial answer' });
  });

  it('does not touch a tool that already finished', () => {
    const finished = play([
      { type: 'tool_start', id: 't1', name: 'calculate' },
      { type: 'tool_call', id: 't1', name: 'calculate', input: {} },
      { type: 'tool_result', id: 't1', ok: true, output: '2', durationMs: 1 },
    ]);

    expect(toolParts(stopMessage(finished))[0]).toMatchObject({ status: 'done', output: '2' });
  });

  describe('citations', () => {
    const citation = {
      documentId: 'd1',
      documentName: 'report.pdf',
      quote: 'Meals are reimbursed.',
      startPage: 4,
      endPage: 4,
    };

    it('places each citation at the end of the text streamed so far, so a chip follows the span it supports', () => {
      const message = play([
        { type: 'round_start' },
        { type: 'text', text: 'Meals are covered.' },
        { type: 'citation', citation },
        { type: 'text', text: ' Receipts are due in 14 days.' },
        {
          type: 'citation',
          citation: { ...citation, quote: 'Receipts', startPage: 5, endPage: 5 },
        },
      ]);

      expect(message.parts).toEqual([
        {
          type: 'text',
          round: 0,
          text: 'Meals are covered. Receipts are due in 14 days.',
          citations: [
            { at: 18, citation },
            { at: 47, citation: { ...citation, quote: 'Receipts', startPage: 5, endPage: 5 } },
          ],
        },
      ]);
    });

    it('starts a text part for a citation that arrives before any text, and one per round', () => {
      const message = play([
        { type: 'round_start' },
        { type: 'citation', citation },
        { type: 'round_start' },
        { type: 'text', text: 'More.' },
        { type: 'citation', citation },
      ]);

      expect(message.parts).toMatchObject([
        { round: 0, text: '', citations: [{ at: 0 }] },
        { round: 1, text: 'More.', citations: [{ at: 5 }] },
      ]);
    });

    it('records that an answer was built from the documents without a model', () => {
      expect(play([{ type: 'answer_mode', mode: 'extractive' }]).mode).toBe('extractive');
    });
  });
});
