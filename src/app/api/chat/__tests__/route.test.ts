// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSseEvents } from "@/lib/sse";
import { collect } from "@/test-utils/model";

// The real SDK class is swapped for one whose stream method is a stub, so no test can reach the API.
const stream = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
    class FakeAnthropic extends actual.default {
        constructor(options: ConstructorParameters<typeof actual.default>[0]) {
            super(options);
            Object.defineProperty(this, "beta", { value: { messages: { stream } } });
        }
    }
    return { ...actual, default: FakeAnthropic };
});

function fakeStream(text: string, outputTokens = 12) {
    const events = [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }];
    return {
        async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
        },
        finalMessage: async () => ({
            stop_reason: "end_turn",
            usage: { input_tokens: 30, output_tokens: outputTokens, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
            content: [{ type: "text", text }],
        }),
    };
}

const goodBody = { model: "claude-sonnet-5-5", messages: [{ role: "user", content: "What is 18% of 2,450, plus 75?" }] };

async function post(body: unknown, headers: Record<string, string> = {}) {
    const { POST } = await import("../route");
    return POST(
        new Request("http://localhost/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", host: "localhost", "x-forwarded-for": "203.0.113.1", ...headers },
            body: typeof body === "string" ? body : JSON.stringify(body),
        }),
    );
}

async function eventsOf(response: Response) {
    if (!response.body) throw new Error("expected a stream");
    return collect(readSseEvents(response.body));
}

describe("POST /api/chat", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv("DEMO_PACE", "0");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        stream.mockReset();
    });

    it.each<{ name: string; body: unknown; headers: Record<string, string>; status: number; code: string }>([
        { name: "a request from another site", body: goodBody, headers: { origin: "https://evil.example" }, status: 403, code: "forbidden" },
        { name: "a body that is not JSON", body: "{oops", headers: {}, status: 400, code: "bad_request" },
        { name: "an empty conversation", body: { ...goodBody, messages: [] }, headers: {}, status: 400, code: "bad_request" },
        { name: "a model that is not on the list", body: { ...goodBody, model: "claude-fable-5-1" }, headers: {}, status: 400, code: "bad_request" },
        {
            name: "a conversation that ends with the assistant",
            body: { ...goodBody, messages: [{ role: "assistant", content: [{ type: "text", text: "Hi" }] }] },
            headers: {},
            status: 400,
            code: "bad_request",
        },
        { name: "a system prompt over the limit", body: { ...goodBody, system: "x".repeat(4001) }, headers: {}, status: 400, code: "bad_request" },
        {
            name: "a tool input that is not an object",
            body: { ...goodBody, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "calculate", input: "1+1" }] }] },
            headers: {},
            status: 400,
            code: "bad_request",
        },
    ])("rejects $name", async ({ body, headers, status, code }) => {
        const response = await post(body, headers);

        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ code });
        expect(stream).not.toHaveBeenCalled();
    });

    it("caps the size of the body, by declared length and by actual length", async () => {
        vi.stubEnv("MAX_BODY_BYTES", "500");

        const declared = await post(goodBody, { "content-length": "100000" });
        const actual = await post({ ...goodBody, messages: [{ role: "user", content: "x".repeat(2000) }] });

        expect([declared.status, actual.status]).toEqual([400, 400]);
    });

    it("limits requests per IP address and says when to come back", async () => {
        vi.stubEnv("RATE_LIMIT_REQUESTS", "2");

        const statuses = [];
        for (let index = 0; index < 3; index += 1) statuses.push((await post(goodBody)).status);
        const other = await post(goodBody, { "x-forwarded-for": "198.51.100.7" });

        expect(statuses).toEqual([200, 200, 429]);
        expect(other.status).toBe(200);
    });

    it("replays a recording in demo mode, with tool results computed by the real tools", async () => {
        const response = await post(goodBody);

        const events = await eventsOf(response);

        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(events.find((event) => event.type === "tool_result")).toMatchObject({ ok: true, output: expect.stringContaining('"result":516') });
        expect(events.at(-1)).toEqual({ type: "done", reason: "end_turn" });
        expect(stream).not.toHaveBeenCalled();
    });

    it("keeps get_time on the frozen demo clock", async () => {
        const events = await eventsOf(await post({ ...goodBody, messages: [{ role: "user", content: "What time is it in Tokyo right now?" }] }));

        expect(events.find((event) => event.type === "tool_result")).toMatchObject({ output: expect.stringContaining("Frozen demo clock") });
    });

    describe("with an API key", () => {
        beforeEach(() => {
            vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
            vi.stubEnv("MAX_OUTPUT_TOKENS", "2000");
        });

        it("streams the model's answer and sends a cached, bounded request", async () => {
            stream.mockReturnValue(fakeStream("The answer is 516."));

            const response = await post({ ...goodBody, model: "claude-opus-5-5", system: "Be brief." });
            const events = await eventsOf(response);

            expect(events).toEqual([
                { type: "round_start" },
                { type: "text", text: "The answer is 516." },
                { type: "usage", usage: { inputTokens: 30, outputTokens: 12, cacheReadTokens: 900, cacheWriteTokens: 0 } },
                { type: "done", reason: "end_turn" },
            ]);
            const [params] = stream.mock.calls[0] ?? [];
            expect(params).toMatchObject({
                model: "claude-opus-5-5",
                max_tokens: 2000,
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
                system: [{ type: "text", text: "Be brief.", cache_control: { type: "ephemeral" } }],
            });
            expect(params.tools.map((tool: { name: string }) => tool.name)).toContain("create_task");
            expect(params.tools.at(-1).cache_control).toEqual({ type: "ephemeral" });
            expect(params.tools.every((tool: { eager_input_streaming: boolean }) => tool.eager_input_streaming)).toBe(true);
        });

        it("tells the user, without vendor or stack details, when the model API rejects the key", async () => {
            const { default: Anthropic } = await import("@anthropic-ai/sdk");
            stream.mockImplementation(() => {
                throw new Anthropic.AuthenticationError(401, { error: { message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
            });

            const events = await eventsOf(await post(goodBody));

            expect(events.at(-1)).toMatchObject({ type: "error", code: "model_error", message: expect.stringContaining("API key was rejected") });
        });
    });
});
