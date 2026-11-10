import { describe, expect, it } from "vitest";
import { collect } from "@/test-utils/model";
import { DENIED_RESULT, type ModelEvent, RESUME_PROMPT, type WireMessage } from "../../protocol";
import { demoTranscripts } from "../demo";
import { UpstreamInterrupted } from "../model-client";
import { createReplayClient, findTranscript } from "../replay-client";

const client = createReplayClient(demoTranscripts, { paceScale: 0 });

function round(messages: WireMessage[], resume = false) {
    return collect(client.streamRound({ model: "claude-sonnet-5-5", system: "", messages, maxTokens: 4096, resume }));
}

function textOf(events: ModelEvent[]): string {
    return events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");
}

const ask = (text: string): WireMessage => ({ role: "user", content: text });

describe("findTranscript", () => {
    it.each([
        ["What is 18% of 2,450, plus 75?", "calc-basic"],
        ["what is 18% of 2450 plus 75", "calc-basic"],
        ["Show me a typescript debounce function", "markdown-code"],
    ])("finds the recording for %s", (prompt, id) => {
        expect(findTranscript(demoTranscripts, prompt)?.id).toBe(id);
    });

    it("has no recording for a prompt it was never given", () => {
        expect(findTranscript(demoTranscripts, "Write me a poem about tractors")).toBeUndefined();
    });
});

describe("replaying a conversation", () => {
    it("plays the round that matches how far the conversation has got", async () => {
        const first = await round([ask("Find my Kyoto notes and add a task to book the tea ceremony.")]);

        expect(first.at(-1)).toMatchObject({ type: "end", stopReason: "tool_use" });
        expect(first.filter((event) => event.type === "tool_start").map((event) => event.type === "tool_start" && event.name)).toEqual(["search_notes"]);

        const second = await round([
            ask("Find my Kyoto notes and add a task to book the tea ceremony."),
            { role: "assistant", content: [{ type: "tool_use", id: "x", name: "search_notes", input: {} }] },
            { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "[]" }] },
        ]);

        expect(second.filter((event) => event.type === "tool_start").map((event) => event.type === "tool_start" && event.name)).toEqual(["create_task"]);
    });

    it("plays a different final answer after the user denied the tool", async () => {
        const events = await round([
            ask("Add a task to renew my passport by 2026-12-01, high priority."),
            { role: "assistant", content: [{ type: "tool_use", id: "x", name: "create_task", input: { title: "Renew passport" } }] },
            { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: DENIED_RESULT, is_error: true }] },
        ]);

        expect(textOf(events)).toContain("I won't add it");
    });

    it("drops the connection part way through the interrupted answer, and finishes it on resume", async () => {
        const prompt = "Explain how server-sent events work, step by step.";
        const dropped: ModelEvent[] = [];
        await expect(
            (async () => {
                for await (const event of client.streamRound({ model: "m", system: "", messages: [ask(prompt)], maxTokens: 4096, resume: false }))
                    dropped.push(event);
            })(),
        ).rejects.toBeInstanceOf(UpstreamInterrupted);

        const partial = textOf(dropped);
        const resumed = await round(
            [ask(prompt), { role: "assistant", content: [{ type: "text", text: partial }] }, { role: "user", content: RESUME_PROMPT }],
            true,
        );

        const full = findTranscript(demoTranscripts, prompt)
            ?.rounds[0]?.events.flatMap((event) => (event.event.type === "text" ? [event.event.text] : []))
            .join("");
        expect(partial + textOf(resumed)).toBe(full);
        expect(resumed.at(-1)).toMatchObject({ type: "end", stopReason: "end_turn" });
    });

    it("says it is in demo mode and lists the prompts it can answer when it has no recording", async () => {
        const events = await round([ask("Write me a poem about tractors")]);

        expect(textOf(events)).toContain("This is demo mode");
        expect(textOf(events)).toContain("What is 18% of 2,450, plus 75?");
    });
});
