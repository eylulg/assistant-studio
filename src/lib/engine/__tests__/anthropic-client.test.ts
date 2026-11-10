// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { collect } from "@/test-utils/model";
import { createAnthropicClient } from "../anthropic-client";
import { ModelFailure, UpstreamInterrupted } from "../model-client";

function clientWith(stream: unknown) {
    const real = new Anthropic({ apiKey: "sk-test" });
    const streamMethod = vi.fn(() => stream);
    Object.defineProperty(real, "beta", { value: { messages: { stream: streamMethod } } });
    return { client: createAnthropicClient(real, "medium"), streamMethod };
}

const request = { model: "claude-sonnet-5-5", system: "s", messages: [], maxTokens: 1000, resume: false };

function streaming(events: unknown[], final: unknown) {
    return {
        async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
        },
        finalMessage: async () => final,
    };
}

describe("createAnthropicClient", () => {
    it("turns the API stream into text and tool-input deltas, then one end event with the complete content", async () => {
        const { client } = clientWith(
            streaming(
                [
                    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking." } },
                    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "calculate", input: {} } },
                    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"expres' } },
                    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'sion":"1+1"}' } },
                ],
                {
                    stop_reason: "tool_use",
                    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 },
                    content: [
                        { type: "thinking", thinking: "", signature: "sig" },
                        { type: "text", text: "Checking." },
                        { type: "tool_use", id: "toolu_1", name: "calculate", input: { expression: "1+1" } },
                        { type: "server_tool_use", id: "x", name: "web_search", input: {} },
                    ],
                },
            ),
        );

        const events = await collect(client.streamRound(request));

        expect(events).toEqual([
            { type: "text", text: "Checking." },
            { type: "tool_start", id: "toolu_1", name: "calculate" },
            { type: "tool_input", id: "toolu_1", delta: '{"expres' },
            { type: "tool_input", id: "toolu_1", delta: 'sion":"1+1"}' },
            {
                type: "end",
                stopReason: "tool_use",
                usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 40 },
                content: [
                    { type: "thinking", thinking: "", signature: "sig" },
                    { type: "text", text: "Checking." },
                    { type: "tool_use", id: "toolu_1", name: "calculate", input: { expression: "1+1" } },
                ],
            },
        ]);
    });

    it.each([
        [
            "a rejected key",
            new Anthropic.AuthenticationError(401, { error: { message: "bad key" } }, "bad key", new Headers()),
            "model_error",
            "API key was rejected",
        ],
        ["a rate limit", new Anthropic.RateLimitError(429, { error: { message: "slow down" } }, "slow down", new Headers()), "rate_limited", "busy"],
        ["a bad request", new Anthropic.BadRequestError(400, { error: { message: "nope" } }, "nope", new Headers()), "model_error", "rejected"],
    ])("explains %s without a stack trace", async (_name, error, code, text) => {
        const { client } = clientWith({
            [Symbol.asyncIterator]() {
                throw error;
            },
        });

        const failure = await collect(client.streamRound(request)).catch((caught: unknown) => caught);

        expect(failure).toBeInstanceOf(ModelFailure);
        expect(failure).toMatchObject({ code, message: expect.stringContaining(text) });
    });

    it("calls a connection that drops after the answer started an interruption", async () => {
        const { client } = clientWith({
            async *[Symbol.asyncIterator]() {
                yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Half" } };
                throw new Anthropic.APIConnectionError({ message: "socket closed" });
            },
        });

        await expect(collect(client.streamRound(request))).rejects.toBeInstanceOf(UpstreamInterrupted);
    });

    it("calls a connection that never opened unavailable, not an interruption", async () => {
        const { client } = clientWith({
            [Symbol.asyncIterator]() {
                throw new Anthropic.APIConnectionError({ message: "refused" });
            },
        });

        await expect(collect(client.streamRound(request))).rejects.toMatchObject({ code: "unavailable" });
    });

    it("passes an abort through untouched", async () => {
        const controller = new AbortController();
        controller.abort();
        const { client } = clientWith({
            [Symbol.asyncIterator]() {
                throw new Anthropic.APIUserAbortError();
            },
        });

        await expect(collect(client.streamRound({ ...request, signal: controller.signal }))).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
    });
});
