import { type StreamEvent, streamEventSchema } from './protocol';

function encodeEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Turns an async iterable of events into an SSE byte stream. Cancelling the stream (the client went away) stops the iterable. */
export function toSseStream(events: AsyncIterable<StreamEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(encodeEvent(value)));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

function parseBlock(block: string): StreamEvent | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    const parsed = streamEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Reads `data:` events from an SSE response body. A body that ends early simply ends the iteration. */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = parseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) yield event;
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
