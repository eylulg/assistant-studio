import { describe, expect, it } from "vitest";
import { z } from "zod";
import { newAssistantMessage } from "@/lib/chat/reducer";
import type { ToolPart } from "@/lib/chat/types";
import type { EvalCase } from "./cases";
import { evaluateCase } from "./checks";
import type { RunResult } from "./harness";

const testCase: EvalCase = {
    id: "demo",
    prompt: "p",
    expect: {
        tools: [{ name: "search_notes", input: z.object({ query: z.string().regex(/lentil/i) }) }],
        answer: { contains: ["cumin"], notContains: [/invented/i], maxChars: 40, citesNote: "note-06" },
    },
};

const FOUND = '{"matches":[{"id":"note-06"}]}';

function run(overrides: { tools?: Partial<ToolPart>[]; text?: string }): RunResult {
    const tools: ToolPart[] = (overrides.tools ?? [{ input: { query: "lentil soup" } }]).map((tool, index) => ({
        type: "tool",
        round: 0,
        id: `t${index}`,
        name: "search_notes",
        status: "done",
        rawInput: "",
        output: FOUND,
        ...tool,
    }));
    return { message: newAssistantMessage("a", "m", "t"), tools, text: overrides.text ?? "Cumin [note-06]", tasks: [] };
}

function failures(result: RunResult) {
    return evaluateCase(testCase, result)
        .filter((check) => !check.passed)
        .map((check) => check.name);
}

describe("the eval checks catch what they are meant to catch", () => {
    it("pass a good run", () => {
        expect(failures(run({}))).toEqual([]);
    });

    it.each([
        ["the wrong tool input shape", run({ tools: [{ input: { query: "pasta" } }] }), ["tool: search_notes", "no unexpected tools"]],
        ["a tool nobody expected", run({ tools: [{ input: { query: "lentil" } }, { name: "calculate", input: {} }] }), ["no unexpected tools"]],
        ["a missing tool call", run({ tools: [] }), ["tool: search_notes", "cites note-06"]],
        ["a tool that failed", run({ tools: [{ input: { query: "lentil" }, status: "error" }] }), ["tool: search_notes"]],
        ["forbidden text", run({ text: "Cumin [note-06], invented" }), ["not contains /invented/i"]],
        ["an answer that is too long", run({ text: `Cumin [note-06] ${"x".repeat(60)}` }), ["at most 40 characters"]],
        ["a missing phrase", run({ text: "Spices [note-06]" }), ['contains "cumin"']],
        ["a citation the search never returned", run({ tools: [{ input: { query: "lentil" }, output: '{"matches":[{"id":"note-02"}]}' }] }), ["cites note-06"]],
        ["no citation", run({ text: "Cumin" }), ["cites note-06"]],
    ])("fail %s", (_name, result, expected) => {
        expect(failures(result)).toEqual(expected);
    });
});
