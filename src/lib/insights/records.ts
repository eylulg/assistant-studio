import type { AnswerMode, Conversation } from '@/lib/chat/types';
import { estimateCostUsd } from '@/lib/models';

export type RecordMode = AnswerMode | 'unknown';

/** One finished answer, flattened from a conversation so every chart reads the same shape. */
export interface AnswerRecord {
  id: string;
  conversationId: string;
  conversationTitle: string;
  /** Milliseconds since the epoch. */
  at: number;
  /** The calendar day of `at` in the zone the records were built for, as `YYYY-MM-DD`. */
  day: string;
  model: string;
  /** `unknown` for answers saved before the mode was recorded. */
  mode: RecordMode;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** An estimate from list prices. */
  costUsd: number;
  /** The names of the tools that ran, one entry per call. */
  tools: string[];
  /** `null` when the answer was saved before timing was recorded, or produced nothing to time. Never zero for "unknown". */
  firstTokenMs: number | null;
  totalMs: number | null;
  /**
   * False for an answer that failed or is waiting for an approval. It still spent tokens, so tokens and cost count it,
   * but it is not an answer to count and its timing says nothing about speed.
   */
  finished: boolean;
}

const FINISHED = new Set(['complete', 'stopped', 'interrupted']);
/** Failed and waiting answers are kept when they used tokens, because those tokens were billed. An answer still streaming is not read yet. */
const SPENT = new Set(['error', 'awaiting_approval']);

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** Every finished answer in every version of every conversation, and every failed or waiting one that used tokens, oldest first. A regenerated answer counts, because it was one. */
export function toRecords(
  conversations: Record<string, Conversation>,
  timeZone: string,
): AnswerRecord[] {
  const format = dayFormatter(timeZone);
  const records: AnswerRecord[] = [];

  for (const conversation of Object.values(conversations)) {
    for (const node of Object.values(conversation.nodes)) {
      const message = node.message;
      if (message.role !== 'assistant') continue;
      const finished = FINISHED.has(message.status);
      const spent = Object.values(message.usage).some((tokens) => tokens > 0);
      if (!finished && !(SPENT.has(message.status) && spent)) continue;
      const at = Date.parse(message.createdAt);
      if (Number.isNaN(at)) continue;
      records.push({
        id: message.id,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        at,
        day: format.format(at),
        model: message.model,
        mode: message.mode ?? 'unknown',
        inputTokens: message.usage.inputTokens,
        outputTokens: message.usage.outputTokens,
        cacheReadTokens: message.usage.cacheReadTokens,
        cacheWriteTokens: message.usage.cacheWriteTokens,
        costUsd: estimateCostUsd(message.model, message.usage),
        tools: message.parts.flatMap((part) =>
          part.type === 'tool' && (part.status === 'done' || part.status === 'error')
            ? [part.name]
            : [],
        ),
        firstTokenMs: message.timing?.firstTokenMs ?? null,
        totalMs: message.timing?.totalMs ?? null,
        finished,
      });
    }
  }
  return records.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
