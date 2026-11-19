import type { ModelClient, RoundRequest } from '@/lib/engine/model-client';
import type { AssistantBlock, ModelEvent, StreamEvent, Usage } from '@/lib/protocol';

export function usage(outputTokens = 10): Usage {
  return { inputTokens: 100, outputTokens, cacheReadTokens: 50, cacheWriteTokens: 0 };
}

/** One model round that streams `text`, then ends with it. */
export function textRound(text: string, outputTokens = 10): ModelEvent[] {
  return [
    { type: 'text', text },
    {
      type: 'end',
      stopReason: 'end_turn',
      usage: usage(outputTokens),
      content: [{ type: 'text', text }],
    },
  ];
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** One model round that asks for tools, streaming each call's input like the API does. */
export function toolRound(calls: ToolCall[], text?: string, stopReason = 'tool_use'): ModelEvent[] {
  const events: ModelEvent[] = [];
  const content: AssistantBlock[] = [];
  if (text) {
    events.push({ type: 'text', text });
    content.push({ type: 'text', text });
  }
  for (const call of calls) {
    events.push({ type: 'tool_start', id: call.id, name: call.name });
    events.push({ type: 'tool_input', id: call.id, delta: JSON.stringify(call.input) });
    content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
  events.push({ type: 'end', stopReason, usage: usage(), content });
  return events;
}

/** A model backend that plays one scripted round per call and remembers every request it was sent. */
export function scriptedClient(rounds: ModelEvent[][]): ModelClient & { requests: RoundRequest[] } {
  const requests: RoundRequest[] = [];
  return {
    requests,
    async *streamRound(request) {
      requests.push(request);
      const events = rounds[requests.length - 1];
      if (!events) throw new Error(`No scripted round ${requests.length}.`);
      for (const event of events) yield event;
    },
  };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

export function types(events: StreamEvent[]): string[] {
  return events.map((event) => event.type);
}
