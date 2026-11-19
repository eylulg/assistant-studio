import { z } from "zod";
import { streamExtractiveAnswer } from "../documents/answer";
import type { QuestionDocument } from "../documents/types";
import { type ChatRequest, type ErrorCode, RESUME_PROMPT, type StreamEvent, type WireDocument, errorCodeSchema } from "../protocol";
import { readSseEvents } from "../sse";

export class TransportError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
    ) {
        super(message);
    }
}

/** `documents` are the ones the question is about: ready and switched on. Empty when there are none. */
export type ChatTransport = (request: ChatRequest, signal: AbortSignal, documents: readonly QuestionDocument[]) => Promise<AsyncIterable<StreamEvent>>;

const errorBodySchema = z.object({ code: errorCodeSchema, message: z.string() });

/** POSTs the conversation and returns the event stream. Failures before the stream starts are TransportErrors. */
const fetchTransport: ChatTransport = async (request, signal) => {
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

function toBase64(bytes: ArrayBuffer): string {
    const view = new Uint8Array(bytes);
    let binary = "";
    for (let offset = 0; offset < view.length; offset += 0x8000) binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
    return btoa(binary);
}

export function toWireDocument(document: QuestionDocument): WireDocument {
    if (document.kind === "pdf" && document.bytes) return { kind: "pdf", id: document.id, name: document.name, data: toBase64(document.bytes) };
    return { kind: "text", id: document.id, name: document.name, text: document.text };
}

/** The text of the newest user turn when it is a fresh question, not tool results or a request to carry on. */
function freshQuestion(request: ChatRequest): string | null {
    const last = request.messages[request.messages.length - 1];
    if (request.resume || last?.role !== "user") return null;
    const blocks = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
    if (blocks.some((block) => block.type === "tool_result")) return null;
    const text = blocks.flatMap((block) => (block.type === "text" && block.text !== RESUME_PROMPT ? [block.text] : [])).join("\n");
    return text || null;
}

/**
 * Chooses where an answer comes from. Without documents, or in live mode, the server answers; in live mode the documents
 * travel with the request. In demo mode a question about documents is answered here, in the browser, by quoting them,
 * so their text never leaves the page and no model is called. What a demo request may carry is decided in two places:
 * here, where it never holds documents, and in `toWireMessages`, where answers that quoted documents become a placeholder.
 */
export function createTransport({ demo }: { demo: boolean }): ChatTransport {
    return async (request, signal, documents) => {
        if (documents.length === 0) return fetchTransport(demo ? { ...request, documents: [] } : request, signal, documents);
        if (!demo) return fetchTransport({ ...request, documents: documents.map(toWireDocument) }, signal, documents);
        const question = freshQuestion(request);
        return question ? streamExtractiveAnswer(question, documents, { signal }) : fetchTransport({ ...request, documents: [] }, signal, documents);
    };
}
