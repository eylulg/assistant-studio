import Anthropic from '@anthropic-ai/sdk';
import { serverConfig } from '@/lib/config';
import { MAX_DOCUMENT_BODY_BYTES } from '@/lib/documents/limits';
import { createAnthropicClient } from '@/lib/engine/anthropic-client';
import { DEMO_NOW, demoTranscripts } from '@/lib/engine/demo';
import { runChat } from '@/lib/engine/engine';
import { createReplayClient } from '@/lib/engine/replay-client';
import { isKnownModel } from '@/lib/models';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/prompt';
import { type ChatRequest, type ErrorCode, chatRequestSchema } from '@/lib/protocol';
import { clientIp, createRateLimiter } from '@/lib/rate-limit';
import { toSseStream } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

let limiter: ReturnType<typeof createRateLimiter> | null = null;

function jsonError(
  status: number,
  code: ErrorCode,
  message: string,
  headers: HeadersInit = {},
): Response {
  return Response.json({ code, message }, { status, headers });
}

/** Browsers send Origin on cross-site POSTs; only this app's own pages may start a chat request. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads at most `maxBytes` of the body. A chunked body has no declared length, so the count is kept while reading and the read stops at the cap. */
async function readBody(request: Request, maxBytes: number): Promise<ChatRequest | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const parsed = chatRequestSchema.safeParse(
      JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const config = serverConfig();

  if (!isSameOrigin(request))
    return jsonError(403, 'forbidden', 'Chat requests can only be sent from this site.');

  limiter ??= createRateLimiter(config.rateLimitPerWindow, config.rateLimitWindowMs);
  const limit = limiter(clientIp(request.headers));
  if (!limit.allowed) {
    return jsonError(
      429,
      'rate_limited',
      `You have sent a lot of messages. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      {
        'Retry-After': String(limit.retryAfterSeconds),
      },
    );
  }

  // Documents are only ever read in live mode, so the demo keeps the small cap.
  const body = await readBody(
    request,
    config.apiKey ? config.maxBodyBytes + MAX_DOCUMENT_BODY_BYTES : config.maxBodyBytes,
  );
  if (!body)
    return jsonError(
      400,
      'bad_request',
      'That request was not valid or was too large. Start a new conversation or shorten it.',
    );
  if (!isKnownModel(body.model))
    return jsonError(400, 'bad_request', 'That model is not available here.');
  if (body.messages[body.messages.length - 1]?.role !== 'user')
    return jsonError(400, 'bad_request', 'The conversation must end with a message from the user.');

  const demo = !config.apiKey;
  const client = demo
    ? createReplayClient(demoTranscripts, { paceScale: config.demoPace })
    : createAnthropicClient(new Anthropic({ apiKey: config.apiKey }), config.effort);

  const events = runChat(
    {
      model: body.model,
      system: body.system?.trim() || DEFAULT_SYSTEM_PROMPT,
      messages: body.messages,
      documents: demo ? [] : body.documents,
      tasks: body.tasks,
      resume: body.resume ?? false,
      maxRounds: config.maxRounds,
      maxOutputTokens: config.maxOutputTokens,
      context: demo
        ? { now: () => new Date(DEMO_NOW), clock: 'frozen', simulateLatency: true }
        : { now: () => new Date(), clock: 'system', simulateLatency: true },
      signal: request.signal,
    },
    client,
  );

  return new Response(toSseStream(events), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
