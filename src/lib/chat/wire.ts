import { z } from "zod";
import { type AssistantBlock, DENIED_RESULT, OMITTED_ANSWER, RESUME_PROMPT, type WireMessage } from "../protocol";
import type { AssistantMessage, Message, ToolPart } from "./types";

type UserBlock = Extract<Extract<WireMessage, { role: "user" }>["content"], unknown[]>[number];

const NOT_RUN = "The tool did not run: the conversation moved on before it finished.";

function parseRaw(raw: string): Record<string, unknown> | null {
    try {
        const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function resultFor(part: ToolPart): UserBlock {
    if (part.status === "done") return { type: "tool_result", tool_use_id: part.id, content: part.output ?? "" };
    if (part.status === "denied") return { type: "tool_result", tool_use_id: part.id, content: DENIED_RESULT, is_error: true };
    if (part.status === "error") return { type: "tool_result", tool_use_id: part.id, content: part.output ?? "The tool failed.", is_error: true };
    return { type: "tool_result", tool_use_id: part.id, content: NOT_RUN, is_error: true };
}

function pushUser(wire: WireMessage[], blocks: UserBlock[]) {
    const last = wire[wire.length - 1];
    if (last?.role === "user") {
        const existing = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
        wire[wire.length - 1] = { role: "user", content: [...existing, ...blocks] };
    } else {
        wire.push({ role: "user", content: blocks });
    }
}

/**
 * Turns one assistant message into the API turns it was made of: per model round, an assistant turn and,
 * when the round called tools, a user turn with their results. A call the stream cut off before its input
 * finished is left out, because the model never completed it. An extractive answer is a quote of the user's documents,
 * so every request carries a placeholder in its place: this is the one place request history is built.
 */
function assistantTurns(message: AssistantMessage, keepReasoning: boolean, wire: WireMessage[]) {
    if (message.mode === "extractive") {
        wire.push({ role: "assistant", content: [{ type: "text", text: OMITTED_ANSWER }] });
        return;
    }
    const rounds = Math.max(message.rounds, ...message.parts.map((part) => part.round + 1));
    for (let round = 0; round < rounds; round += 1) {
        const parts = message.parts.filter((part) => part.round === round);
        const content: AssistantBlock[] = [];
        const results: UserBlock[] = [];

        // Reasoning blocks come first and are returned unchanged, but only for the turn still in progress.
        if (keepReasoning) for (const part of parts) if (part.type === "reasoning") content.push(part.block);
        for (const part of parts) {
            if (part.type === "text" && part.text.trim()) content.push({ type: "text", text: part.text });
            if (part.type === "tool") {
                const input = part.input ?? (part.status === "streaming" ? null : parseRaw(part.rawInput));
                if (!input) continue;
                content.push({ type: "tool_use", id: part.id, name: part.name, input });
                results.push(resultFor(part));
            }
        }

        if (!content.some((block) => block.type === "text" || block.type === "tool_use")) continue;
        if (message.resumes.includes(round)) pushUser(wire, [{ type: "text", text: RESUME_PROMPT }]);
        wire.push({ role: "assistant", content });
        if (results.length > 0) pushUser(wire, results);
    }
    // A resume that has been requested but has not streamed yet: the request ends with the ask to continue.
    if (message.resumes.includes(rounds)) pushUser(wire, [{ type: "text", text: RESUME_PROMPT }]);
}

/** The conversation as the server expects it. `path` is the messages from the first one to the one being answered. */
export function toWireMessages(path: Message[]): WireMessage[] {
    const wire: WireMessage[] = [];
    const lastAssistantId = [...path].reverse().find((message) => message.role === "assistant")?.id;
    for (const message of path) {
        if (message.role === "user") pushUser(wire, [{ type: "text", text: message.text }]);
        else assistantTurns(message, message.id === lastAssistantId, wire);
    }
    return wire;
}
