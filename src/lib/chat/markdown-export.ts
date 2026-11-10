import { estimateCostUsd, formatCost, modelLabel } from "../models";
import { activePath } from "./tree";
import type { AssistantMessage, Conversation, Part, ToolPart } from "./types";

function pretty(text: string | undefined): string {
    if (!text) return "";
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

const STATUS_LABEL: Record<ToolPart["status"], string> = {
    streaming: "cut off",
    awaiting_approval: "waiting for approval",
    running: "cut off",
    done: "done",
    error: "failed",
    denied: "denied by the user",
    cancelled: "cancelled",
};

function toolBlock(part: ToolPart): string {
    const input = JSON.stringify(part.approvedInput ?? part.input ?? {}, null, 2);
    const lines = [
        `> **Tool call: ${part.name}** (${STATUS_LABEL[part.status]}${part.durationMs !== undefined ? `, ${part.durationMs} ms` : ""})`,
        "",
        "```json",
        input,
        "```",
    ];
    if (part.output) lines.push("", "Result:", "", "```json", pretty(part.output), "```");
    return lines.join("\n");
}

function partBlock(part: Part): string | null {
    if (part.type === "text") return part.text.trim() || null;
    if (part.type === "tool") return toolBlock(part);
    return null;
}

function assistantSection(message: AssistantMessage): string {
    const body = message.parts.map(partBlock).filter((block): block is string => block !== null);
    const notes: string[] = [];
    if (message.status === "stopped") notes.push("_Stopped by the user._");
    if (message.status === "interrupted") notes.push("_The connection was interrupted before this answer finished._");
    if (message.status === "error") notes.push(`_Error: ${message.error ?? "the request failed"}._`);
    const { usage } = message;
    const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    const cost =
        total + usage.outputTokens > 0
            ? `${modelLabel(message.model)}, ${total} input and ${usage.outputTokens} output tokens, about ${formatCost(estimateCostUsd(message.model, usage))}`
            : modelLabel(message.model);
    return ["## Assistant", ...body, ...notes, `_${cost}_`].join("\n\n");
}

/** The visible branch of a conversation as Markdown. Reasoning blocks are opaque and are left out. */
export function conversationToMarkdown(conversation: Conversation): string {
    const sections = activePath(conversation).map(({ message }) => (message.role === "user" ? `## You\n\n${message.text}` : assistantSection(message)));
    return [`# ${conversation.title}`, ...sections].join("\n\n") + "\n";
}
