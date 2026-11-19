import { z } from "zod";
import { MAX_DOCUMENTS, MAX_DOCUMENT_BODY_BYTES, MAX_TOTAL_CHARS } from "./documents/limits";
import { taskSchema } from "./tools/types";

export const MAX_SYSTEM_CHARS = 4000;

/** The tool result the client sends when the user denies a side-effect tool. */
export const DENIED_RESULT = "The user denied this action. Do not try it again unless they ask.";

/** Sent as a user turn after a cut-off answer. The API does not accept a prefilled assistant turn, so the partial answer stays in the history and this asks for the rest. */
export const RESUME_PROMPT = "Your previous answer was interrupted. Continue exactly where it stopped, without repeating anything you already wrote.";
const MAX_MESSAGES = 120;
const MAX_TEXT_CHARS = 60_000;

/** Reasoning blocks are opaque: the client stores them and sends them back unchanged while a turn is still running. */
const reasoningBlockSchema = z.union([
    z.object({ type: z.literal("thinking"), thinking: z.string().max(200_000), signature: z.string().max(20_000) }),
    z.object({ type: z.literal("redacted_thinking"), data: z.string().max(200_000) }),
]);

const textBlockSchema = z.object({ type: z.literal("text"), text: z.string().max(MAX_TEXT_CHARS) });
const toolUseBlockSchema = z.object({
    type: z.literal("tool_use"),
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(64),
    input: z.record(z.string(), z.unknown()),
});
const toolResultBlockSchema = z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().min(1).max(100),
    content: z.string().max(MAX_TEXT_CHARS),
    is_error: z.boolean().optional(),
});

const assistantBlockSchema = z.union([reasoningBlockSchema, textBlockSchema, toolUseBlockSchema]);

const wireMessageSchema = z.discriminatedUnion("role", [
    z.object({
        role: z.literal("user"),
        content: z.union([z.string().max(MAX_TEXT_CHARS), z.array(z.union([textBlockSchema, toolResultBlockSchema])).max(40)]),
    }),
    z.object({ role: z.literal("assistant"), content: z.array(assistantBlockSchema).max(60) }),
]);

/**
 * A document sent to the model, live mode only. Text files go as text. A PDF goes as the original file in base64,
 * so the model can read layout and cite by page. The order of this list is the `document_index` the API cites by.
 */
const wireDocumentSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), id: z.string().min(1).max(100), name: z.string().min(1).max(200), text: z.string().min(1).max(MAX_TOTAL_CHARS) }),
    z.object({
        kind: z.literal("pdf"),
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(200),
        data: z.string().min(1).max(MAX_DOCUMENT_BODY_BYTES),
    }),
]);

export type WireDocument = z.infer<typeof wireDocumentSchema>;

export type WireMessage = z.infer<typeof wireMessageSchema>;
export type AssistantBlock = z.infer<typeof assistantBlockSchema>;

export const chatRequestSchema = z.object({
    model: z.string().max(100),
    system: z.string().max(MAX_SYSTEM_CHARS).optional(),
    messages: z.array(wireMessageSchema).min(1).max(MAX_MESSAGES),
    tasks: z.array(taskSchema).max(100).default([]),
    /** Documents the question is about. Ignored in demo mode, where answers are built in the browser and nothing is uploaded. */
    documents: z.array(wireDocumentSchema).max(MAX_DOCUMENTS).default([]),
    /** The last assistant message was cut off; ask the model to carry on from it. */
    resume: z.boolean().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

const usageSchema = z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof usageSchema>;

export const doneReasonSchema = z.enum(["end_turn", "awaiting_approval", "max_tokens", "max_rounds", "refusal", "budget"]);
export type DoneReason = z.infer<typeof doneReasonSchema>;

export const errorCodeSchema = z.enum(["bad_request", "rate_limited", "model_error", "forbidden", "unavailable"]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * A place in a document that an answer rests on. A character range (`start`, exclusive `end`) is exact. A PDF
 * citation from the model has pages only (`startPage` to `endPage`, both included, counted from 1) and the
 * browser finds the quoted text on those pages. `quote` is the text as cited.
 */
export const citationSchema = z.object({
    documentId: z.string(),
    documentName: z.string(),
    quote: z.string(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
    startPage: z.number().int().positive().optional(),
    endPage: z.number().int().positive().optional(),
});

export type Citation = z.infer<typeof citationSchema>;

const toolInputObject = z.record(z.string(), z.unknown());

/** Everything the server sends to the browser, one JSON object per server-sent event. */
export const streamEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("round_start") }),
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("reasoning"), block: reasoningBlockSchema }),
    z.object({ type: z.literal("tool_start"), id: z.string(), name: z.string() }),
    z.object({ type: z.literal("tool_input"), id: z.string(), delta: z.string() }),
    z.object({ type: z.literal("tool_call"), id: z.string(), name: z.string(), input: toolInputObject }),
    z.object({ type: z.literal("tool_pending"), id: z.string(), name: z.string(), input: toolInputObject }),
    z.object({ type: z.literal("tool_result"), id: z.string(), ok: z.boolean(), output: z.string(), durationMs: z.number().nonnegative() }),
    /** The text streamed so far is supported by this place in a document. It attaches at the end of the current text. */
    z.object({ type: z.literal("citation"), citation: citationSchema }),
    /** How the answer was made. `extractive` means it was assembled from the user's documents in the browser, with no model call. */
    z.object({ type: z.literal("answer_mode"), mode: z.literal("extractive") }),
    z.object({ type: z.literal("usage"), usage: usageSchema }),
    z.object({ type: z.literal("done"), reason: doneReasonSchema }),
    z.object({ type: z.literal("interrupted"), reason: z.string() }),
    z.object({ type: z.literal("error"), code: errorCodeSchema, message: z.string() }),
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;

/** What a model backend (the real API, or a recording) emits for one round. The engine builds StreamEvents from it. */
export const modelEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("tool_start"), id: z.string(), name: z.string() }),
    z.object({ type: z.literal("tool_input"), id: z.string(), delta: z.string() }),
    /** A citation from the model. `documentIndex` counts the documents of the request in order. */
    z.object({
        type: z.literal("citation"),
        documentIndex: z.number().int().nonnegative(),
        citation: citationSchema.omit({ documentId: true, documentName: true }),
    }),
    z.object({ type: z.literal("end"), stopReason: z.string(), usage: usageSchema, content: z.array(assistantBlockSchema) }),
]);

export type ModelEvent = z.infer<typeof modelEventSchema>;
