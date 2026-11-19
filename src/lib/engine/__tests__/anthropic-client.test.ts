// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { collect } from "@/test-utils/model";
import { createAnthropicClient } from "../anthropic-client";
import { ModelFailure, UpstreamInterrupted } from "../model-client";

function clientWith(stream: unknown) {
    const real = new Anthropic({ apiKey: "sk-test" });
    const streamMethod = vi.fn((..._args: unknown[]) => stream);
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

function citationOf(quote: string) {
    return { type: "char_location", cited_text: quote, document_index: 0, document_title: "notes.txt", start_char_index: 0, end_char_index: quote.length };
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

    describe("documents", () => {
        const finalMessage = { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [] };
        const documents = [
            { kind: "text" as const, id: "a", name: "notes.txt", text: "Alpha text" },
            { kind: "pdf" as const, id: "b", name: "report.pdf", data: "JVBERi0xLjQ=" },
        ];

        it("puts every document ahead of the first question with citations on, caches the documents as one prefix and tells the model about them", async () => {
            const { client, streamMethod } = clientWith(streaming([], finalMessage));
            const messages = [
                { role: "user" as const, content: "First question" },
                { role: "assistant" as const, content: [{ type: "text" as const, text: "An answer" }] },
                { role: "user" as const, content: "Second question" },
            ];

            await collect(client.streamRound({ ...request, messages, documents }));

            const params: unknown = streamMethod.mock.calls[0]?.[0];
            expect(params).toMatchObject({
                system: [
                    expect.objectContaining({ cache_control: { type: "ephemeral" } }),
                    { type: "text", text: expect.stringContaining("attached documents") },
                ],
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "document",
                                title: "notes.txt",
                                source: { type: "text", media_type: "text/plain", data: "Alpha text" },
                                citations: { enabled: true },
                            },
                            {
                                type: "document",
                                title: "report.pdf",
                                source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQ=" },
                                citations: { enabled: true },
                                cache_control: { type: "ephemeral" },
                            },
                            { type: "text", text: "First question" },
                        ],
                    },
                    { role: "assistant" },
                    { role: "user", content: "Second question" },
                ],
            });
            const first: unknown = (params as { messages: { content: unknown[] }[] }).messages[0]?.content[0];
            expect(first).not.toHaveProperty("cache_control");
        });

        it("sends the request exactly as before when there are no documents", async () => {
            const { client, streamMethod } = clientWith(streaming([], finalMessage));

            await collect(client.streamRound({ ...request, messages: [{ role: "user", content: "Hi" }], documents: [] }));

            const params: unknown = streamMethod.mock.calls[0]?.[0];
            expect(params).toMatchObject({ system: [{ type: "text", text: "s" }], messages: [{ role: "user", content: "Hi" }] });
        });

        it("places a citation after the text of its own block, even when it arrives before that text", async () => {
            const cite = { type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: citationOf("Alpha") } };
            const { client } = clientWith(
                streaming(
                    [
                        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Plain." } },
                        { type: "content_block_stop", index: 0 },
                        cite,
                        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Cited." } },
                        { type: "content_block_stop", index: 1 },
                    ],
                    finalMessage,
                ),
            );

            const events = await collect(client.streamRound({ ...request, documents }));

            expect(events.map((event) => (event.type === "text" ? event.text : event.type)).slice(0, 3)).toEqual(["Plain.", "Cited.", "citation"]);
        });

        it("turns streamed citations into citation events, with the end page of a page citation made inclusive", async () => {
            const cite = (citation: unknown) => ({ type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation } });
            const { client } = clientWith(
                streaming(
                    [
                        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Meals are covered." } },
                        cite({
                            type: "char_location",
                            cited_text: "Alpha",
                            document_index: 0,
                            document_title: "notes.txt",
                            start_char_index: 0,
                            end_char_index: 5,
                        }),
                        { type: "content_block_stop", index: 0 },
                        cite({
                            type: "page_location",
                            cited_text: "Meals",
                            document_index: 1,
                            document_title: "report.pdf",
                            start_page_number: 4,
                            end_page_number: 5,
                        }),
                        cite({
                            type: "page_location",
                            cited_text: "Span",
                            document_index: 1,
                            document_title: "report.pdf",
                            start_page_number: 4,
                            end_page_number: 7,
                        }),
                        cite({ type: "web_search_result_location", cited_text: "x", encrypted_index: "e", title: null, url: "https://example.com" }),
                    ],
                    finalMessage,
                ),
            );

            const events = await collect(client.streamRound({ ...request, documents }));

            expect(events.filter((event) => event.type === "citation")).toEqual([
                { type: "citation", documentIndex: 0, citation: { quote: "Alpha", start: 0, end: 5 } },
                { type: "citation", documentIndex: 1, citation: { quote: "Meals", startPage: 4, endPage: 4 } },
                { type: "citation", documentIndex: 1, citation: { quote: "Span", startPage: 4, endPage: 6 } },
            ]);
        });
    });
});
