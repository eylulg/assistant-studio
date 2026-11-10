import { z } from "zod";
import { type ChatRequest, type ErrorCode, type StreamEvent, errorCodeSchema } from "../protocol";
import { readSseEvents } from "../sse";

export class TransportError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
    ) {
        super(message);
    }
}

export type ChatTransport = (request: ChatRequest, signal: AbortSignal) => Promise<AsyncIterable<StreamEvent>>;

const errorBodySchema = z.object({ code: errorCodeSchema, message: z.string() });

/** POSTs the conversation and returns the event stream. Failures before the stream starts are TransportErrors. */
export const fetchTransport: ChatTransport = async (request, signal) => {
    let response: Response;
    try {
        response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new TransportError("unavailable", "Could not reach the server. Check your connection and try again.");
    }

    if (!response.ok || !response.body) {
        const parsed = errorBodySchema.safeParse(await response.json().catch(() => null));
        throw new TransportError(
            parsed.success ? parsed.data.code : "unavailable",
            parsed.success ? parsed.data.message : "The server could not answer right now. Try again in a moment.",
        );
    }
    return readSseEvents(response.body);
};
