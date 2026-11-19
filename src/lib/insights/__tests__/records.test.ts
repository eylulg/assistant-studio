import { describe, expect, it } from "vitest";
import { newAssistantMessage } from "@/lib/chat/reducer";
import type { AssistantMessage, Conversation } from "@/lib/chat/types";
import { toRecords } from "../records";

function assistant(id: string, overrides: Partial<AssistantMessage>): AssistantMessage {
    return { ...newAssistantMessage(id, "claude-sonnet-5-5", "2026-11-10T23:30:00.000Z"), status: "complete", ...overrides };
}

function conversation(messages: AssistantMessage[]): Conversation {
    return {
        id: "c1",
        title: "Chat",
        createdAt: "2026-11-10T23:00:00.000Z",
        updatedAt: "2026-11-10T23:30:00.000Z",
        nodes: Object.fromEntries(messages.map((message) => [message.id, { id: message.id, parentId: null, message }])),
        order: [],
        active: {},
    };
}

describe("toRecords", () => {
    it("keeps finished answers only, counts tools that ran, and reads the day in the given zone", () => {
        const done = assistant("done", {
            usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            parts: [
                { type: "tool", round: 0, id: "t1", name: "calculate", status: "done", rawInput: "" },
                { type: "tool", round: 0, id: "t2", name: "create_task", status: "denied", rawInput: "" },
            ],
        });
        const records = toRecords(
            {
                c1: conversation([
                    done,
                    assistant("busy", { status: "streaming" }),
                    assistant("failed", { status: "error" }),
                    assistant("stopped", { status: "stopped" }),
                ]),
            },
            "Europe/Amsterdam",
        );

        expect(records.map((record) => record.id).sort()).toEqual(["done", "stopped"]);
        expect(records.find((record) => record.id === "done")).toMatchObject({ day: "2026-11-11", tools: ["calculate"], costUsd: 2 });
        expect(toRecords({ c1: conversation([done]) }, "UTC")[0]?.day).toBe("2026-11-10");
    });

    it("also keeps a failed or waiting answer that used tokens, marked unfinished, because those tokens were billed", () => {
        const used = { inputTokens: 500, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

        const records = toRecords(
            {
                c1: conversation([
                    assistant("failed", { status: "error", usage: used }),
                    assistant("waiting", { status: "awaiting_approval", usage: used }),
                    assistant("empty", { status: "error" }),
                    assistant("busy", { status: "streaming", usage: used }),
                ]),
            },
            "UTC",
        );

        expect(records.map((record) => [record.id, record.finished]).sort()).toEqual([
            ["failed", false],
            ["waiting", false],
        ]);
    });

    it("reports a missing mode as unknown and missing timing as null, never zero", () => {
        const old = assistant("old", { mode: undefined, timing: undefined });
        const timed = assistant("new", { mode: "replay", timing: { firstTokenMs: 120, totalMs: 900 } });

        const records = toRecords({ c1: conversation([old, timed]) }, "UTC");

        expect(records.find((record) => record.id === "old")).toMatchObject({ mode: "unknown", firstTokenMs: null, totalMs: null });
        expect(records.find((record) => record.id === "new")).toMatchObject({ mode: "replay", firstTokenMs: 120, totalMs: 900 });
    });
});
