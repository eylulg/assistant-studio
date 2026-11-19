import type { AssistantBlock, DoneReason, ModelEvent, StreamEvent, WireDocument, WireMessage } from "../protocol";
import { type ToolOutcome, findTool, runTool, validateInput } from "../tools";
import type { Task, Tool, ToolContext } from "../tools/types";
import { type ModelClient, ModelFailure, UpstreamInterrupted } from "./model-client";

/** Below this many output tokens left, another round could not finish a useful answer. */
const MIN_ROUND_TOKENS = 300;

export interface EngineOptions {
    model: string;
    system: string;
    messages: WireMessage[];
    documents?: readonly WireDocument[];
    tasks: readonly Task[];
    resume: boolean;
    maxRounds: number;
    /** Output tokens across every round of this request. */
    maxOutputTokens: number;
    context: Omit<ToolContext, "tasks" | "signal">;
    signal?: AbortSignal;
}

type ToolUse = Extract<AssistantBlock, { type: "tool_use" }>;

interface Prepared {
    use: ToolUse;
    tool: Tool;
    input: unknown;
}

function toolUses(content: AssistantBlock[]): ToolUse[] {
    return content.filter((block): block is ToolUse => block.type === "tool_use");
}

function describeError(error: unknown): string {
    return error instanceof ModelFailure ? error.message : "The model could not answer right now. Try again in a moment.";
}

/**
 * One request of the two-phase tool protocol. It streams model rounds, runs tools that have no side
 * effects as soon as the model asks, and stops with `awaiting_approval` when a side-effect tool is
 * pending: the browser asks the user, runs the tool itself and sends the whole conversation again.
 * The server keeps no state between the two phases.
 */
export async function* runChat(options: EngineOptions, client: ModelClient): AsyncGenerator<StreamEvent> {
    const { signal } = options;
    const messages = [...options.messages];
    const documents = options.documents ?? [];
    const context: ToolContext = { ...options.context, tasks: options.tasks, signal };
    let outputUsed = 0;

    for (let round = 0; round < options.maxRounds; round += 1) {
        const remaining = options.maxOutputTokens - outputUsed;
        if (remaining < MIN_ROUND_TOKENS) {
            yield { type: "done", reason: "budget" };
            return;
        }

        yield { type: "round_start" };

        let end: Extract<ModelEvent, { type: "end" }> | undefined;
        try {
            const stream = client.streamRound({
                model: options.model,
                system: options.system,
                messages,
                documents,
                maxTokens: remaining,
                resume: options.resume && round === 0,
                signal,
            });
            for await (const event of stream) {
                if (event.type === "end") end = event;
                else if (event.type === "citation") {
                    // The model cites a document by its position in the request. The browser needs the id it stored it under.
                    const document = documents[event.documentIndex];
                    if (document) yield { type: "citation", citation: { ...event.citation, documentId: document.id, documentName: document.name } };
                } else yield event;
            }
        } catch (error) {
            if (signal?.aborted) return;
            if (error instanceof UpstreamInterrupted) {
                yield { type: "interrupted", reason: error.message };
                return;
            }
            yield { type: "error", code: error instanceof ModelFailure ? error.code : "model_error", message: describeError(error) };
            return;
        }

        if (!end) {
            yield { type: "interrupted", reason: "The model stream ended before the answer was complete." };
            return;
        }

        yield { type: "usage", usage: end.usage };
        for (const block of end.content) if (block.type === "thinking" || block.type === "redacted_thinking") yield { type: "reasoning", block };
        outputUsed += end.usage.outputTokens;

        const uses = toolUses(end.content);
        const stop = stopOutcome(end.stopReason, uses.length);
        if (stop) {
            yield { type: "done", reason: stop };
            return;
        }

        const results = new Map<string, ToolOutcome>();
        const prepared: Prepared[] = [];
        let pending = 0;

        for (const use of uses) {
            const tool = findTool(use.name);
            if (!tool) {
                results.set(use.id, { ok: false, error: `Unknown tool "${use.name}".` });
                yield { type: "tool_result", id: use.id, ok: false, output: `Unknown tool "${use.name}".`, durationMs: 0 };
                continue;
            }
            const validated = validateInput(tool, use.input);
            if (!validated.ok) {
                results.set(use.id, { ok: false, error: validated.error });
                yield { type: "tool_result", id: use.id, ok: false, output: validated.error, durationMs: 0 };
                continue;
            }
            if (tool.sideEffect) {
                pending += 1;
                yield { type: "tool_pending", id: use.id, name: use.name, input: use.input };
                continue;
            }
            prepared.push({ use, tool, input: validated.input });
            yield { type: "tool_call", id: use.id, name: use.name, input: use.input };
        }

        const running = new Map(
            prepared.map(({ use, tool, input }) => {
                const started = performance.now();
                const promise = runTool(tool, input, context).then((outcome) => ({ id: use.id, outcome, durationMs: Math.round(performance.now() - started) }));
                return [use.id, promise] as const;
            }),
        );

        try {
            while (running.size > 0) {
                const { id, outcome, durationMs } = await Promise.race(running.values());
                running.delete(id);
                results.set(id, outcome);
                yield { type: "tool_result", id, ok: outcome.ok, output: outcome.ok ? JSON.stringify(outcome.output) : outcome.error, durationMs };
            }
        } catch (error) {
            if (signal?.aborted) return;
            throw error;
        }

        if (pending > 0) {
            yield { type: "done", reason: "awaiting_approval" };
            return;
        }

        messages.push({ role: "assistant", content: end.content });
        messages.push({
            role: "user",
            content: uses.map((use) => {
                const outcome = results.get(use.id);
                return outcome?.ok
                    ? { type: "tool_result" as const, tool_use_id: use.id, content: JSON.stringify(outcome.output) }
                    : { type: "tool_result" as const, tool_use_id: use.id, content: outcome?.error ?? "The tool did not run.", is_error: true };
            }),
        });
    }

    yield { type: "done", reason: "max_rounds" };
}

function stopOutcome(stopReason: string, toolUseCount: number): DoneReason | null {
    if (stopReason === "refusal") return "refusal";
    // A tool call cut off by the token limit has an unreliable input, so it is never run.
    if (stopReason === "max_tokens") return "max_tokens";
    if (toolUseCount === 0) return "end_turn";
    return null;
}
