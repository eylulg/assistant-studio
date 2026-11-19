import { z } from "zod";
import { citationSchema, doneReasonSchema } from "../protocol";
import { taskSchema } from "../tools/types";

const reasoningBlockSchema = z.union([
    z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
    z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
]);

const toolStatusSchema = z.enum(["streaming", "awaiting_approval", "running", "done", "error", "denied", "cancelled"]);
export type ToolStatus = z.infer<typeof toolStatusSchema>;

const inputSchema = z.record(z.string(), z.unknown());

/** A citation placed in a text part: `at` is the offset in the part's text where the cited span ends. */
const placedCitationSchema = z.object({ at: z.number().int().nonnegative(), citation: citationSchema });
export type PlacedCitation = z.infer<typeof placedCitationSchema>;

const partSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), round: z.number().int().nonnegative(), text: z.string(), citations: z.array(placedCitationSchema).optional() }),
    z.object({ type: z.literal("reasoning"), round: z.number().int().nonnegative(), block: reasoningBlockSchema }),
    z.object({
        type: z.literal("tool"),
        round: z.number().int().nonnegative(),
        id: z.string(),
        name: z.string(),
        status: toolStatusSchema,
        /** The input JSON as it streams in, shown until the validated input arrives. */
        rawInput: z.string(),
        input: inputSchema.optional(),
        /** What the user approved when they edited the input before approving. The model's own call stays as it was. */
        approvedInput: inputSchema.optional(),
        output: z.string().optional(),
        durationMs: z.number().nonnegative().optional(),
    }),
]);

export type Part = z.infer<typeof partSchema>;
export type ToolPart = Extract<Part, { type: "tool" }>;

const messageStatusSchema = z.enum(["streaming", "awaiting_approval", "complete", "stopped", "interrupted", "error"]);

const userMessageSchema = z.object({ role: z.literal("user"), id: z.string(), text: z.string(), createdAt: z.string() });

const assistantMessageSchema = z.object({
    role: z.literal("assistant"),
    id: z.string(),
    model: z.string(),
    createdAt: z.string(),
    status: messageStatusSchema,
    parts: z.array(partSchema),
    /** Model rounds seen so far. Parts carry the round they belong to. */
    rounds: z.number().int().nonnegative(),
    /** Rounds that started with a resume request, so the history can replay the request that was sent. */
    resumes: z.array(z.number().int().nonnegative()),
    usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number(), cacheWriteTokens: z.number() }),
    doneReason: doneReasonSchema.optional(),
    /** `extractive`: assembled from the user's documents in the browser, no model call. Absent for model answers. */
    mode: z.literal("extractive").optional(),
    error: z.string().optional(),
});

const messageSchema = z.discriminatedUnion("role", [userMessageSchema, assistantMessageSchema]);

export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type Message = z.infer<typeof messageSchema>;

const nodeSchema = z.object({ id: z.string(), parentId: z.string().nullable(), message: messageSchema });

export type MessageNode = z.infer<typeof nodeSchema>;

/** A conversation is a tree: editing a message or regenerating adds a sibling, and `active` remembers which sibling is showing. */
const conversationSchema = z.object({
    id: z.string(),
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    nodes: z.record(z.string(), nodeSchema),
    order: z.array(z.string()),
    active: z.record(z.string(), z.string()),
});

export type Conversation = z.infer<typeof conversationSchema>;

const settingsSchema = z.object({ model: z.string(), systemPrompt: z.string().max(4000) });
export type Settings = z.infer<typeof settingsSchema>;

export const persistedStateSchema = z.object({
    version: z.literal(1),
    conversations: z.record(z.string(), conversationSchema),
    order: z.array(z.string()),
    activeId: z.string().nullable(),
    settings: settingsSchema,
    tasks: z.array(taskSchema),
});

export type PersistedState = z.infer<typeof persistedStateSchema>;
