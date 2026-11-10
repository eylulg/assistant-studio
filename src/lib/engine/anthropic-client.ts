import Anthropic from "@anthropic-ai/sdk";
import type { AssistantBlock, ModelEvent } from "../protocol";
import { toolDefinitions } from "../tools";
import { type ModelClient, ModelFailure, type RoundRequest, UpstreamInterrupted } from "./model-client";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function toolsForRequest() {
    const definitions = toolDefinitions();
    // eager_input_streaming streams tool input as it is generated. The engine validates every input with zod before running it.
    // The cache breakpoint on the last tool, plus the one on the system prompt, caches both as one prefix.
    return definitions.map((definition, index) => ({
        ...definition,
        eager_input_streaming: true,
        ...(index === definitions.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
}

function contentOf(message: Anthropic.Beta.BetaMessage): AssistantBlock[] {
    const content: AssistantBlock[] = [];
    for (const block of message.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "thinking") content.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
        else if (block.type === "redacted_thinking") content.push({ type: "redacted_thinking", data: block.data });
        else if (block.type === "tool_use") content.push({ type: "tool_use", id: block.id, name: block.name, input: isRecord(block.input) ? block.input : {} });
    }
    return content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureFor(error: unknown): ModelFailure | null {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        return new ModelFailure("model_error", "The server's model API key was rejected. Check the key in the server settings.");
    }
    if (error instanceof Anthropic.RateLimitError) return new ModelFailure("rate_limited", "The model is busy right now. Try again in a minute.");
    if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
        return new ModelFailure("model_error", `The model request was rejected: ${error.message}`);
    }
    if (error instanceof Anthropic.APIError && !(error instanceof Anthropic.APIConnectionError))
        return new ModelFailure("model_error", "The model returned an error. Try again.");
    return null;
}

/**
 * The real model backend: one streamed Messages API call per round, with the system prompt and the
 * tool definitions cached, effort set, and server-side fallback on so a policy refusal is retried on
 * the recommended fallback model instead of ending the answer.
 */
export function createAnthropicClient(client: Anthropic, effort: Effort): ModelClient {
    return {
        async *streamRound({ model, system, messages, maxTokens, signal }: RoundRequest): AsyncGenerator<ModelEvent> {
            const toolIds = new Map<number, string>();
            let started = false;
            try {
                const stream = client.beta.messages.stream(
                    {
                        model,
                        max_tokens: maxTokens,
                        betas: ["server-side-fallback-2026-07-01"],
                        fallbacks: "default",
                        output_config: { effort },
                        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
                        tools: toolsForRequest(),
                        messages,
                    },
                    { signal },
                );

                for await (const event of stream) {
                    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
                        toolIds.set(event.index, event.content_block.id);
                        started = true;
                        yield { type: "tool_start", id: event.content_block.id, name: event.content_block.name };
                    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                        started = true;
                        yield { type: "text", text: event.delta.text };
                    } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
                        const id = toolIds.get(event.index);
                        if (id) yield { type: "tool_input", id, delta: event.delta.partial_json };
                    }
                }

                const message = await stream.finalMessage();
                const usage = message.usage;
                yield {
                    type: "end",
                    stopReason: message.stop_reason ?? "end_turn",
                    usage: {
                        inputTokens: usage.input_tokens,
                        outputTokens: usage.output_tokens,
                        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
                        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
                    },
                    content: contentOf(message),
                };
            } catch (error) {
                if (error instanceof Anthropic.APIUserAbortError || signal?.aborted) throw error;
                const failure = failureFor(error);
                if (failure) throw failure;
                if (started) throw new UpstreamInterrupted("The connection to the model dropped.");
                throw new ModelFailure("unavailable", "Could not reach the model. Check your connection and try again.");
            }
        },
    };
}
