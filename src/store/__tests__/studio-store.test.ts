import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { STORAGE_KEY } from "@/lib/chat/persistence";
import { TransportError, createTransport } from "@/lib/chat/transport";
import { activePath } from "@/lib/chat/tree";
import { OMITTED_ANSWER, RESUME_PROMPT, type StreamEvent } from "@/lib/protocol";
import { toSseStream } from "@/lib/sse";
import { memoryRepository, textDocument } from "@/test-utils/documents";
import { memoryStorage, scriptedTransport, testStore, untilAborted } from "@/test-utils/store";
import { createDocumentsStore } from "../documents-store";
import type { StudioState } from "../studio-store";

const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

const answer = (text: string): StreamEvent[] => [
    { type: "round_start" },
    { type: "text", text },
    { type: "usage", usage },
    { type: "done", reason: "end_turn" },
];

const createTaskRound: StreamEvent[] = [
    { type: "round_start" },
    { type: "text", text: "Adding it." },
    { type: "tool_start", id: "t1", name: "create_task" },
    { type: "tool_pending", id: "t1", name: "create_task", input: { title: "Renew passport", due: "2026-12-01" } },
    { type: "done", reason: "awaiting_approval" },
];

function visible(store: StoreApi<StudioState>) {
    const state = store.getState();
    const conversation = state.activeId ? state.conversations[state.activeId] : undefined;
    return conversation ? activePath(conversation).map((node) => node.message) : [];
}

function lastAssistant(store: StoreApi<StudioState>) {
    const message = visible(store).at(-1);
    if (message?.role !== "assistant") throw new Error("expected an assistant message");
    return message;
}

function patchStatus(conversations: StudioState["conversations"], id: string, status: "interrupted"): StudioState["conversations"] {
    return Object.fromEntries(
        Object.entries(conversations).map(([key, conversation]) => [
            key,
            {
                ...conversation,
                nodes: Object.fromEntries(
                    Object.entries(conversation.nodes).map(([nodeId, node]) => [
                        nodeId,
                        nodeId === id && node.message.role === "assistant" ? { ...node, message: { ...node.message, status } } : node,
                    ]),
                ),
            },
        ]),
    );
}

function textOf(store: StoreApi<StudioState>): string {
    return lastAssistant(store)
        .parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("");
}

describe("sending a message", () => {
    it("streams the answer into the conversation and sends the history with the tasks and settings", async () => {
        const { transport, requests } = scriptedTransport([answer("Hello there")]);
        const store = testStore(transport);
        store.getState().setSystemPrompt("Be brief.");

        await store.getState().send("  Hi  ");

        expect(visible(store).map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(textOf(store)).toBe("Hello there");
        expect(lastAssistant(store)).toMatchObject({ status: "complete", usage });
        expect(store.getState().conversations[store.getState().activeId ?? ""]?.title).toBe("Hi");
        expect(requests[0]).toMatchObject({
            model: "claude-sonnet-5-5",
            system: "Be brief.",
            messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
            tasks: [],
        });
        expect(store.getState().streaming).toBeNull();
    });

    it("ignores a message while an answer is streaming", async () => {
        const { transport, requests } = scriptedTransport([
            async function* (signal) {
                yield { type: "round_start" } as const;
                await untilAborted(signal);
            },
        ]);
        const store = testStore(transport);

        const first = store.getState().send("One");
        await store.getState().send("Two");
        store.getState().stop();
        await first;

        expect(requests).toHaveLength(1);
        expect(visible(store).filter((message) => message.role === "user")).toHaveLength(1);
    });

    it("shows an error with the server's explanation when the request is refused, and keeps the question", async () => {
        const store = testStore(async () => {
            throw new TransportError("rate_limited", "You have sent a lot of messages. Try again in 10 minutes.");
        });

        await store.getState().send("Hi");

        expect(lastAssistant(store)).toMatchObject({ status: "error", error: "You have sent a lot of messages. Try again in 10 minutes." });
        expect(visible(store)[0]).toMatchObject({ role: "user", text: "Hi" });
    });
});

describe("answer mode and timing", () => {
    function slowAnswer(clock: { time: number }) {
        return (): AsyncIterable<StreamEvent> =>
            (async function* () {
                clock.time += 300;
                yield { type: "round_start" };
                yield { type: "text", text: "Hi" };
                clock.time += 700;
                yield { type: "done", reason: "end_turn" };
            })();
    }

    it("records the time to the first text and the total, from the clock the store was given", async () => {
        const clock = { time: Date.parse("2026-11-10T09:30:00.000Z") };
        const store = testStore(scriptedTransport([slowAnswer(clock)]).transport, { now: () => new Date(clock.time) });

        await store.getState().send("Hi");

        expect(lastAssistant(store).timing).toEqual({ firstTokenMs: 300, totalMs: 1000 });
    });

    it.each([
        { demo: false, mode: "model" },
        { demo: true, mode: "replay" },
    ])("marks an answer from a demo=$demo store as $mode", async ({ demo, mode }) => {
        const store = testStore(scriptedTransport([answer("Hello")]).transport, { demo });

        await store.getState().send("Hi");

        expect(lastAssistant(store).mode).toBe(mode);
    });
});

describe("asking about documents", () => {
    it("asks for the documents of the conversation being answered and hands them to the transport with the question", async () => {
        const refunds = textDocument("d1", "refunds.txt", "Refund within 30 days.");
        const asked: string[] = [];
        const handed: unknown[] = [];
        const store = testStore(
            async (_request, _signal, documents) => {
                handed.push(documents);
                return (async function* () {
                    for (const event of answer("Quoted.")) yield event;
                })();
            },
            {
                documents: async (conversationId) => {
                    asked.push(conversationId);
                    return [refunds];
                },
            },
        );

        await store.getState().send("How long do I have?");

        expect(asked).toEqual([store.getState().activeId]);
        expect(handed).toEqual([[refunds]]);
        expect(visible(store)[1]).toMatchObject({ status: "complete" });
    });

    it("shows an error the user can act on when the stored documents cannot be read, and sends nothing", async () => {
        const { transport, requests } = scriptedTransport([answer("Never sent.")]);
        const store = testStore(transport, {
            documents: async () => {
                throw new Error("IndexedDB is not available.");
            },
        });

        await store.getState().send("How long do I have?");

        expect(requests).toEqual([]);
        expect(visible(store)[1]).toMatchObject({ status: "error", error: expect.stringContaining("documents could not be read") });
    });
});

describe("demo mode and the text of documents", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends no text of a document in any request after the document was used, switched off and removed", async () => {
        const bodies: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: unknown, init?: RequestInit) => {
                bodies.push(String(init?.body));
                const events: StreamEvent[] = [{ type: "round_start" }, { type: "text", text: "From a recording." }, { type: "done", reason: "end_turn" }];
                return new Response(
                    toSseStream(
                        (async function* () {
                            for (const event of events) yield event;
                        })(),
                    ),
                );
            }),
        );
        const documents = createDocumentsStore({ repository: memoryRepository(), newId: () => "d1", now: () => new Date("2026-11-10T09:30:00.000Z") });
        const store = testStore(createTransport({ demo: true }), { demo: true, documents: (id) => documents.getState().forQuestion(id) });
        store.getState().newConversation();
        const conversationId = store.getState().activeId ?? "";
        await documents.getState().add(conversationId, [new File(["Visitors sign in at the front desk before nine."], "handbook.txt")]);

        await store.getState().send("Where do visitors sign in?");
        const quoted = lastAssistant(store);
        await documents.getState().setEnabled(conversationId, "d1", false);
        await store.getState().send("What can you do?");
        await documents.getState().remove(conversationId, "d1");
        await store.getState().send("Show me an example");
        await store.getState().regenerate(lastAssistant(store).id);
        store.setState((state) => ({ ...state, conversations: patchStatus(state.conversations, quoted.id, "interrupted") }));
        await store.getState().resume(quoted.id);

        expect(quoted.mode).toBe("extractive");
        expect(bodies).toHaveLength(4);
        expect(bodies.some((body) => body.includes(OMITTED_ANSWER))).toBe(true);
        for (const body of bodies) expect(body).not.toMatch(/Visitors sign in|front desk|before nine|handbook/);
    });
});

describe("Stop", () => {
    it("keeps the partial answer and cancels the tool that was running", async () => {
        const { transport } = scriptedTransport([
            async function* (signal) {
                yield { type: "round_start" } as const;
                yield { type: "text", text: "Partial" } as const;
                yield { type: "tool_start", id: "t1", name: "lookup_weather" } as const;
                yield { type: "tool_call", id: "t1", name: "lookup_weather", input: { city: "Oslo" } } as const;
                await untilAborted(signal);
                throw new DOMException("Aborted", "AbortError");
            },
        ]);
        const store = testStore(transport);

        const sending = store.getState().send("Weather?");
        await vi.waitFor(() => expect(textOf(store)).toBe("Partial"));
        store.getState().stop();
        await sending;

        const message = lastAssistant(store);
        expect(message.status).toBe("stopped");
        expect(textOf(store)).toBe("Partial");
        expect(message.parts.find((part) => part.type === "tool")).toMatchObject({ status: "cancelled" });
        expect(store.getState().streaming).toBeNull();
    });
});

describe("a dropped connection and Resume", () => {
    const cutOff = (): StreamEvent[] => [{ type: "round_start" }, { type: "text", text: "Server-sent events let a server" }];

    it("ends the stream as interrupted, not as an error, and keeps what arrived", async () => {
        const { transport } = scriptedTransport([cutOff()]);
        const store = testStore(transport);

        await store.getState().send("Explain");

        expect(lastAssistant(store)).toMatchObject({ status: "interrupted" });
        expect(lastAssistant(store).error).toBeUndefined();
        expect(textOf(store)).toBe("Server-sent events let a server");
    });

    it("treats a read error in the middle of the stream the same way", async () => {
        const { transport } = scriptedTransport([
            async function* () {
                yield { type: "round_start" } as const;
                yield { type: "text", text: "Half" } as const;
                throw new TypeError("network error");
            },
        ]);
        const store = testStore(transport);

        await store.getState().send("Explain");

        expect(lastAssistant(store)).toMatchObject({ status: "interrupted" });
        expect(textOf(store)).toBe("Half");
    });

    it("resumes by sending the partial answer as context with a request to continue, and appends the rest to the same message", async () => {
        const { transport, requests } = scriptedTransport([
            cutOff(),
            [{ type: "round_start" }, { type: "text", text: " pushes text." }, { type: "done", reason: "end_turn" }],
        ]);
        const store = testStore(transport);
        await store.getState().send("Explain");
        const messageId = lastAssistant(store).id;

        await store.getState().resume(messageId);

        expect(requests[1]).toMatchObject({ resume: true });
        expect(requests[1]?.messages).toEqual([
            { role: "user", content: [{ type: "text", text: "Explain" }] },
            { role: "assistant", content: [{ type: "text", text: "Server-sent events let a server" }] },
            { role: "user", content: [{ type: "text", text: RESUME_PROMPT }] },
        ]);
        expect(visible(store)).toHaveLength(2);
        expect(textOf(store)).toBe("Server-sent events let a server pushes text.");
        expect(lastAssistant(store)).toMatchObject({ status: "complete", resumes: [1] });
    });

    it("only resumes an interrupted answer", async () => {
        const { transport, requests } = scriptedTransport([answer("Done")]);
        const store = testStore(transport);
        await store.getState().send("Hi");

        await store.getState().resume(lastAssistant(store).id);

        expect(requests).toHaveLength(1);
    });

    it("can be interrupted again and resumed again", async () => {
        const { transport, requests } = scriptedTransport([
            cutOff(),
            [{ type: "round_start" }, { type: "text", text: " pushes" }],
            [{ type: "round_start" }, { type: "text", text: " text." }, { type: "done", reason: "end_turn" }],
        ]);
        const store = testStore(transport);
        await store.getState().send("Explain");
        await store.getState().resume(lastAssistant(store).id);
        await store.getState().resume(lastAssistant(store).id);

        expect(textOf(store)).toBe("Server-sent events let a server pushes text.");
        expect(
            requests[2]?.messages.filter(
                (message) =>
                    message.role === "user" &&
                    Array.isArray(message.content) &&
                    message.content.some((block) => block.type === "text" && block.text === RESUME_PROMPT),
            ),
        ).toHaveLength(2);
    });
});

describe("the two-phase tool protocol on the client", () => {
    it("waits for approval, runs the tool in the browser, and sends the result in a second request", async () => {
        const { transport, requests } = scriptedTransport([createTaskRound, answer("Done.")]);
        const store = testStore(transport);
        await store.getState().send("Add a task");
        expect(lastAssistant(store).status).toBe("awaiting_approval");
        expect(store.getState().tasks).toEqual([]);

        await store.getState().approveTool(lastAssistant(store).id, "t1");

        expect(store.getState().tasks).toEqual([
            { id: "task-1", title: "Renew passport", due: "2026-12-01", priority: "normal", done: false, createdAt: "2026-11-10T09:30:00.000Z" },
        ]);
        const second = requests[1]?.messages.at(-1);
        expect(second).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: expect.stringContaining('"created"') }] });
        expect(lastAssistant(store)).toMatchObject({ status: "complete" });
        expect(lastAssistant(store).parts.find((part) => part.type === "tool")).toMatchObject({ status: "done" });
    });

    it("runs the edited input, tells the model what ran, and leaves the model's own call as it was", async () => {
        const { transport, requests } = scriptedTransport([createTaskRound, answer("Done.")]);
        const store = testStore(transport);
        await store.getState().send("Add a task");

        await store.getState().approveTool(lastAssistant(store).id, "t1", { title: "Renew passport online", priority: "high" });

        expect(store.getState().tasks[0]).toMatchObject({ title: "Renew passport online", priority: "high" });
        const assistantTurn = requests[1]?.messages.at(-2);
        expect(assistantTurn).toMatchObject({
            role: "assistant",
            content: expect.arrayContaining([{ type: "tool_use", id: "t1", name: "create_task", input: { title: "Renew passport", due: "2026-12-01" } }]),
        });
        expect(requests[1]?.messages.at(-1)).toMatchObject({ content: [{ content: expect.stringContaining("Renew passport online") }] });
    });

    it("sends a denial as an error result and adds nothing to the task list", async () => {
        const { transport, requests } = scriptedTransport([createTaskRound, answer("Understood.")]);
        const store = testStore(transport);
        await store.getState().send("Add a task");

        await store.getState().denyTool(lastAssistant(store).id, "t1");

        expect(store.getState().tasks).toEqual([]);
        expect(requests[1]?.messages.at(-1)).toMatchObject({
            content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: expect.stringContaining("denied") }],
        });
        expect(lastAssistant(store).parts.find((part) => part.type === "tool")).toMatchObject({ status: "denied" });
    });

    it("waits until every parallel approval is answered before continuing", async () => {
        const two: StreamEvent[] = [
            { type: "round_start" },
            { type: "tool_start", id: "t1", name: "create_task" },
            { type: "tool_pending", id: "t1", name: "create_task", input: { title: "One" } },
            { type: "tool_start", id: "t2", name: "create_task" },
            { type: "tool_pending", id: "t2", name: "create_task", input: { title: "Two" } },
            { type: "done", reason: "awaiting_approval" },
        ];
        const { transport, requests } = scriptedTransport([two, answer("Done.")]);
        const store = testStore(transport);
        await store.getState().send("Add two");

        await store.getState().approveTool(lastAssistant(store).id, "t1");
        expect(requests).toHaveLength(1);
        await store.getState().approveTool(lastAssistant(store).id, "t2");

        expect(requests).toHaveLength(2);
        expect(store.getState().tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    });

    it("skips an approval the user ignored when they send another message", async () => {
        const { transport, requests } = scriptedTransport([createTaskRound, answer("Sure.")]);
        const store = testStore(transport);
        await store.getState().send("Add a task");

        await store.getState().send("Never mind, what is 2+2?");

        const earlier = [...Object.values(store.getState().conversations[store.getState().activeId ?? ""]?.nodes ?? {})].find(
            (node) => node.message.role === "assistant",
        );
        expect(earlier?.message.role === "assistant" && earlier.message.parts.find((part) => part.type === "tool")).toMatchObject({ status: "cancelled" });
        expect(store.getState().tasks).toEqual([]);
        expect(requests[1]?.messages.at(-1)).toMatchObject({
            role: "user",
            content: [
                { type: "tool_result", tool_use_id: "t1", is_error: true },
                { type: "text", text: "Never mind, what is 2+2?" },
            ],
        });
    });
});

describe("branching", () => {
    async function twoTurns() {
        const { transport, requests } = scriptedTransport([
            answer("Answer one"),
            answer("Answer two"),
            answer("Answer one, reworded"),
            answer("Answer two, again"),
        ]);
        const store = testStore(transport);
        await store.getState().send("First");
        await store.getState().send("Second");
        return { store, requests };
    }

    it("forks when an earlier message is edited: the new branch sends only the history before it, and the old branch stays", async () => {
        const { store, requests } = await twoTurns();
        const firstId = visible(store)[0]?.id ?? "";

        await store.getState().editMessage(firstId, "First, reworded");

        expect(visible(store).map((message) => (message.role === "user" ? message.text : "assistant"))).toEqual(["First, reworded", "assistant"]);
        expect(requests[2]?.messages).toEqual([{ role: "user", content: [{ type: "text", text: "First, reworded" }] }]);

        store.getState().selectVersion(firstId);
        expect(visible(store).map((message) => (message.role === "user" ? message.text : textOfMessage(message)))).toEqual([
            "First",
            "Answer one",
            "Second",
            "Answer two",
        ]);
    });

    it("regenerates into a sibling answer without losing the first", async () => {
        const { store, requests } = await twoTurns();
        const answerId = lastAssistant(store).id;

        await store.getState().regenerate(answerId);

        expect(textOf(store)).toBe("Answer one, reworded");
        expect(requests[2]?.messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "text", text: "Second" }] });
        const parent = store.getState().conversations[store.getState().activeId ?? ""]?.nodes[answerId]?.parentId ?? "";
        store.getState().selectVersion(answerId);
        expect(textOf(store)).toBe("Answer two");
        expect(parent).not.toBe("");
    });

    it("does not switch versions while an answer is streaming", async () => {
        const { store } = await twoTurns();
        const firstId = visible(store)[0]?.id ?? "";
        await store.getState().editMessage(firstId, "Other");
        store.setState({ streaming: { conversationId: "x", nodeId: "y" } });

        store.getState().selectVersion(firstId);

        expect(visible(store)[0]).toMatchObject({ text: "Other" });
    });
});

function textOfMessage(message: ReturnType<typeof lastAssistant>): string {
    return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

describe("saving", () => {
    it("brings back a saved conversation after a reload", async () => {
        const storage = memoryStorage();
        const { transport } = scriptedTransport([answer("Hello")]);
        const first = testStore(transport, { storage: () => storage });
        await first.getState().send("Hi");
        first.getState().persistNow();

        const second = testStore(scriptedTransport([]).transport, { storage: () => storage });
        second.setState({ hydrated: false });
        second.getState().hydrate();

        expect(visible(second).map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(second.getState().hydrated).toBe(true);
    });

    it("says it is not saving when the browser refuses to store", async () => {
        const storage = memoryStorage({}, { failWrites: true });
        const { transport } = scriptedTransport([answer("Hello")]);
        const store = testStore(transport, { storage: () => storage });
        await store.getState().send("Hi");

        store.getState().persistNow();

        expect(store.getState().persistence).toBe("failed");
        expect(storage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("starts empty and keeps working when the saved data is damaged", () => {
        const store = testStore(scriptedTransport([]).transport, { storage: () => memoryStorage({ [STORAGE_KEY]: "{damaged" }) });
        store.setState({ hydrated: false });

        store.getState().hydrate();

        expect(store.getState()).toMatchObject({ hydrated: true, conversations: {}, tasks: [] });
    });
});
