import { DENIED_RESULT, type ModelEvent, RESUME_PROMPT, type WireMessage } from '../protocol';
import { sleep } from '../tools/types';
import { type ModelClient, type RoundRequest, UpstreamInterrupted } from './model-client';
import type { TimedEvent, Transcript } from './transcripts';

const MIN_SIMILARITY = 0.6;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a: string, b: string): number {
  const left = new Set(normalise(a).split(' '));
  const right = new Set(normalise(b).split(' '));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / (left.size + right.size - shared || 1);
}

function textOf(message: WireMessage): string | null {
  if (message.role !== 'user') return null;
  if (typeof message.content === 'string')
    return message.content === RESUME_PROMPT ? null : message.content;
  const text = message.content
    .flatMap((block) => (block.type === 'text' && block.text !== RESUME_PROMPT ? [block.text] : []))
    .join('\n');
  return text || null;
}

/** The prompt a round answers: the last user turn that carries text of its own, not tool results or the resume request. */
function lastPrompt(messages: WireMessage[]): { prompt: string; index: number } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const text = message ? textOf(message) : null;
    if (text) return { prompt: text, index };
  }
  return null;
}

/** Which round of the transcript is next: assistant turns since the prompt, not counting the ones a resume continues. */
function roundIndex(messages: WireMessage[], promptIndex: number): number {
  let count = 0;
  for (let index = promptIndex + 1; index < messages.length; index += 1) {
    if (messages[index]?.role !== 'assistant') continue;
    const next = messages[index + 1];
    const resumed =
      next?.role === 'user' &&
      (next.content === RESUME_PROMPT ||
        (Array.isArray(next.content) &&
          next.content.some((block) => block.type === 'text' && block.text === RESUME_PROMPT)));
    if (!resumed) count += 1;
  }
  return count;
}

function wasDenied(messages: WireMessage[]): boolean {
  const last = messages[messages.length - 1];
  return (
    last?.role === 'user' &&
    Array.isArray(last.content) &&
    last.content.some((block) => block.type === 'tool_result' && block.content === DENIED_RESULT)
  );
}

export function findTranscript(
  transcripts: readonly Transcript[],
  prompt: string,
): Transcript | undefined {
  const wanted = normalise(prompt);
  const exact = transcripts.find((transcript) => normalise(transcript.prompt) === wanted);
  if (exact) return exact;
  const scored = transcripts
    .map((transcript) => ({ transcript, score: similarity(transcript.prompt, prompt) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score >= MIN_SIMILARITY ? best.transcript : undefined;
}

function noRecording(prompt: string, transcripts: readonly Transcript[]): TimedEvent[] {
  const examples = transcripts
    .filter((transcript) => transcript.suggested)
    .map((transcript) => `- ${transcript.prompt}`)
    .join('\n');
  const text = `This is demo mode, so I can only replay answers that were recorded ahead of time, and I have no recording for "${prompt.slice(0, 80)}". Try one of these instead:\n\n${examples}`;
  const events: TimedEvent[] = [];
  let at = 0;
  for (const chunk of text.match(/.{1,6}/gs) ?? []) {
    at += 15;
    events.push({ atMs: at, event: { type: 'text', text: chunk } });
  }
  events.push({
    atMs: at + 5,
    event: {
      type: 'end',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      content: [{ type: 'text', text }],
    },
  });
  return events;
}

/** A model backend that replays recordings. `paceScale` 0 replays instantly, 1 at the recorded speed. */
export function createReplayClient(
  transcripts: readonly Transcript[],
  options: { paceScale?: number } = {},
): ModelClient {
  const scale = options.paceScale ?? 1;

  return {
    async *streamRound({ messages, resume, signal }: RoundRequest): AsyncGenerator<ModelEvent> {
      const found = lastPrompt(messages);
      const transcript = found ? findTranscript(transcripts, found.prompt) : undefined;
      const index = found ? roundIndex(messages, found.index) : 0;

      let events: TimedEvent[];
      let drop = false;
      if (!transcript) {
        events = noRecording(found?.prompt ?? '', transcripts);
      } else if (resume && transcript.interruption) {
        events = transcript.interruption.resume.events;
      } else if (wasDenied(messages) && transcript.denied) {
        events = transcript.denied.events;
      } else {
        const round = transcript.rounds[index];
        events = round?.events ?? [];
        const interruption = transcript.interruption;
        if (interruption && interruption.round === index) {
          events = events.slice(0, interruption.afterEvents);
          drop = true;
        }
      }

      let previous = 0;
      for (const { atMs, event } of events) {
        if (scale > 0) await sleep(Math.max(0, atMs - previous) * scale, signal);
        previous = atMs;
        yield event;
      }
      if (drop) throw new UpstreamInterrupted('The connection dropped (recorded interruption).');
    },
  };
}
