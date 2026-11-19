import type { AnswerMode, Conversation } from "@/lib/chat/types";
import { estimateCostUsd } from "@/lib/models";

export type RecordMode = AnswerMode | "unknown";

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
}

/** Answers that are still being written, waiting for an approval or failed have nothing finished to measure. */
const FINISHED = new Set(["complete", "stopped", "interrupted"]);

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}

/** Every finished answer in every version of every conversation, oldest first. A regenerated answer counts, because it was one. */
export function toRecords(conversations: Record<string, Conversation>, timeZone: string): AnswerRecord[] {
    const format = dayFormatter(timeZone);
    const records: AnswerRecord[] = [];

    for (const conversation of Object.values(conversations)) {
        for (const node of Object.values(conversation.nodes)) {
            const message = node.message;
            if (message.role !== "assistant" || !FINISHED.has(message.status)) continue;
            const at = Date.parse(message.createdAt);
            if (Number.isNaN(at)) continue;
            records.push({
                id: message.id,
                conversationId: conversation.id,
                conversationTitle: conversation.title,
                at,
                day: format.format(at),
                model: message.model,
                mode: message.mode ?? "unknown",
                inputTokens: message.usage.inputTokens,
                outputTokens: message.usage.outputTokens,
                cacheReadTokens: message.usage.cacheReadTokens,
                cacheWriteTokens: message.usage.cacheWriteTokens,
                costUsd: estimateCostUsd(message.model, message.usage),
                tools: message.parts.flatMap((part) => (part.type === "tool" && (part.status === "done" || part.status === "error") ? [part.name] : [])),
                firstTokenMs: message.timing?.firstTokenMs ?? null,
                totalMs: message.timing?.totalMs ?? null,
            });
        }
    }
    return records.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}
