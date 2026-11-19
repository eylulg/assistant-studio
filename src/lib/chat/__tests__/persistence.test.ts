import { describe, expect, it } from 'vitest';
import { memoryStorage } from '@/test-utils/storage';
import { STORAGE_KEY, emptyState, loadState, saveState } from '../persistence';
import { applyStreamEvent, newAssistantMessage } from '../reducer';
import { appendMessage, createConversation } from '../tree';
import type { PersistedState } from '../types';

const NOW = '2026-11-10T09:30:00.000Z';

function stateWith(conversationCount = 1, streaming = false): PersistedState {
  const conversations: PersistedState['conversations'] = {};
  const order: string[] = [];
  for (let index = 0; index < conversationCount; index += 1) {
    const id = `c${index}`;
    let conversation = createConversation(id, NOW);
    conversation = appendMessage(
      conversation,
      null,
      { role: 'user', id: `u${index}`, text: `Question ${index}`, createdAt: NOW },
      NOW,
    );
    let message = newAssistantMessage(`a${index}`, 'claude-sonnet-5-5', NOW);
    message = [
      { type: 'round_start' as const },
      { type: 'text' as const, text: 'Partial' },
      { type: 'tool_start' as const, id: 't1', name: 'lookup_weather' },
      { type: 'tool_call' as const, id: 't1', name: 'lookup_weather', input: { city: 'Oslo' } },
      ...(streaming ? [] : [{ type: 'done' as const, reason: 'end_turn' as const }]),
    ].reduce(applyStreamEvent, message);
    conversation = appendMessage(conversation, `u${index}`, message, NOW);
    conversations[id] = conversation;
    order.push(id);
  }
  return {
    ...emptyState('claude-sonnet-5-5'),
    conversations,
    order,
    activeId: order[0] ?? null,
    tasks: [
      { id: 'task-1', title: 'Renew passport', priority: 'high', done: false, createdAt: NOW },
    ],
  };
}

describe('saved state', () => {
  it('comes back the way it was saved', () => {
    const storage = memoryStorage();
    const state = {
      ...stateWith(2),
      settings: { model: 'claude-opus-5-5', systemPrompt: 'Be brief.' },
    };

    expect(saveState(storage, state)).toBe(true);

    expect(loadState(storage)).toEqual(state);
  });

  it.each([
    ['nothing saved yet', {}],
    ['text that is not JSON', { [STORAGE_KEY]: '{oops' }],
    ['JSON in an old shape', { [STORAGE_KEY]: JSON.stringify({ version: 0, conversations: [] }) }],
    [
      'a conversation with a damaged message',
      { [STORAGE_KEY]: JSON.stringify({ ...stateWith(1), conversations: { c0: { id: 'c0' } } }) },
    ],
  ])('starts fresh instead of throwing for %s', (_name, initial) => {
    expect(loadState(memoryStorage(initial))).toBeNull();
  });

  it('starts fresh when the browser has no storage at all', () => {
    expect(loadState(null)).toBeNull();
    expect(saveState(null, stateWith())).toBe(false);
  });

  it('turns an answer that was still streaming when the page closed into an interrupted one that can resume', () => {
    const storage = memoryStorage();
    saveState(storage, stateWith(1, true));

    const loaded = loadState(storage);
    const message = loaded?.conversations['c0']?.nodes['a0']?.message;

    expect(message).toMatchObject({ role: 'assistant', status: 'interrupted' });
    expect(
      message?.role === 'assistant' && message.parts.find((part) => part.type === 'tool'),
    ).toMatchObject({ status: 'cancelled' });
  });

  it('reports a refused write instead of throwing, so the app can say it is not saving', () => {
    expect(saveState(memoryStorage({}, { failWrites: true }), stateWith())).toBe(false);
  });

  it('keeps only the 30 most recent conversations', () => {
    const storage = memoryStorage();
    saveState(storage, stateWith(35));

    const loaded = loadState(storage);

    expect(loaded?.order).toHaveLength(30);
    expect(Object.keys(loaded?.conversations ?? {})).toHaveLength(30);
    expect(loaded?.order[0]).toBe('c0');
  });
});
