import type { StreamEvent } from "../protocol";
import type { AssistantMessage, Part, ToolPart } from "./types";

export function newAssistantMessage(id: string, model: string, createdAt: string): AssistantMessage {
    return {
        role: "assistant",
        id,
        model,
        createdAt,
        status: "streaming",
        parts: [],
        rounds: 0,
        resumes: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
}

function updateTool(parts: Part[], id: string, update: (part: ToolPart) => ToolPart): Part[] {
    return parts.map((part) => (part.type === "tool" && part.id === id ? update(part) : part));
}

/** Tool calls that never got a result because the stream ended first can no longer finish. */
function settleOpenTools(parts: Part[], output: string): Part[] {
    return parts.map((part) =>
        part.type === "tool" && (part.status === "streaming" || part.status === "running") ? { ...part, status: "cancelled", output } : part,
    );
}

/** The user pressed Stop. Whatever streamed so far stays. */
export function stopMessage(message: AssistantMessage): AssistantMessage {
    return { ...message, status: "stopped", parts: settleOpenTools(message.parts, "Stopped before it finished.") };
}

/** The connection ended before the model finished. Not an error: the partial answer is kept and can be resumed. */
export function interruptMessage(message: AssistantMessage): AssistantMessage {
    return { ...message, status: "interrupted", parts: settleOpenTools(message.parts, "The connection was lost before this finished.") };
}

export function failMessage(message: AssistantMessage, error: string): AssistantMessage {
    return { ...message, status: "error", error, parts: settleOpenTools(message.parts, "Did not run because the request failed.") };
}

/** Pure reducer from one server event to the assistant message it belongs to. */
export function applyStreamEvent(message: AssistantMessage, event: StreamEvent): AssistantMessage {
    const round = Math.max(0, message.rounds - 1);

    switch (event.type) {
        case "round_start":
            return { ...message, rounds: message.rounds + 1 };
        case "text": {
            const last = message.parts[message.parts.length - 1];
            if (last?.type === "text" && last.round === round) {
                return { ...message, parts: [...message.parts.slice(0, -1), { ...last, text: last.text + event.text }] };
            }
            return { ...message, parts: [...message.parts, { type: "text", round, text: event.text }] };
        }
        case "citation": {
            const last = message.parts[message.parts.length - 1];
            if (last?.type === "text" && last.round === round) {
                const citations = [...(last.citations ?? []), { at: last.text.length, citation: event.citation }];
                return { ...message, parts: [...message.parts.slice(0, -1), { ...last, citations }] };
            }
            return { ...message, parts: [...message.parts, { type: "text", round, text: "", citations: [{ at: 0, citation: event.citation }] }] };
        }
        case "answer_mode":
            return { ...message, mode: event.mode };
        case "reasoning":
            return { ...message, parts: [...message.parts, { type: "reasoning", round, block: event.block }] };
        case "tool_start":
            if (message.parts.some((part) => part.type === "tool" && part.id === event.id)) return message;
            return { ...message, parts: [...message.parts, { type: "tool", round, id: event.id, name: event.name, status: "streaming", rawInput: "" }] };
        case "tool_input":
            return { ...message, parts: updateTool(message.parts, event.id, (part) => ({ ...part, rawInput: part.rawInput + event.delta })) };
        case "tool_call":
            return { ...message, parts: updateTool(message.parts, event.id, (part) => ({ ...part, status: "running", input: event.input })) };
        case "tool_pending":
            return { ...message, parts: updateTool(message.parts, event.id, (part) => ({ ...part, status: "awaiting_approval", input: event.input })) };
        case "tool_result":
            return {
                ...message,
                parts: updateTool(message.parts, event.id, (part) => ({
                    ...part,
                    status: event.ok ? "done" : "error",
                    output: event.output,
                    durationMs: event.durationMs,
                })),
            };
        case "usage":
            return {
                ...message,
                usage: {
                    inputTokens: message.usage.inputTokens + event.usage.inputTokens,
                    outputTokens: message.usage.outputTokens + event.usage.outputTokens,
                    cacheReadTokens: message.usage.cacheReadTokens + event.usage.cacheReadTokens,
                    cacheWriteTokens: message.usage.cacheWriteTokens + event.usage.cacheWriteTokens,
                },
            };
        case "done":
            return {
                ...message,
                status: event.reason === "awaiting_approval" ? "awaiting_approval" : "complete",
                doneReason: event.reason,
                parts: settleOpenTools(message.parts, "Cut off by the output limit before the input was complete."),
            };
        case "interrupted":
            return interruptMessage(message);
        case "error":
            return failMessage(message, event.message);
    }
}
