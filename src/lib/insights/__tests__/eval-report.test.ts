import { CASES } from "@evals/cases";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evalReportSchema, staleness } from "../eval-report";

const report = evalReportSchema.parse(JSON.parse(readFileSync("evals/reports/fixture.json", "utf8")));

describe("the committed fixture report", () => {
    it("still describes the cases in evals/cases.ts. Run npm run eval and commit evals/reports/fixture.json when this fails", () => {
        expect(staleness(report, CASES)).toEqual([]);
    });
});

describe("staleness", () => {
    const cases = [
        { id: "a", prompt: "First?" },
        { id: "b", prompt: "Second?" },
    ];
    const result = (id: string, prompt: string) => ({ id, prompt, status: "pass" as const, tools: [], checks: [], chars: 0, tokens: 0, costUsd: 0 });
    const reportOf = (...entries: ReturnType<typeof result>[]) => ({ version: 1 as const, kind: "fixture" as const, model: "m", cases: entries });

    it.each([
        { name: "matches", entries: [result("a", "First?"), result("b", "Second?")], expected: [] },
        { name: "a new case", entries: [result("a", "First?")], expected: ["b is not in the report"] },
        {
            name: "a removed case",
            entries: [result("a", "First?"), result("b", "Second?"), result("c", "Third?")],
            expected: ["c is in the report but no longer a case"],
        },
        { name: "a changed prompt", entries: [result("a", "First?"), result("b", "Other?")], expected: ["b has a different prompt now"] },
    ])("reports $name", ({ entries, expected }) => {
        expect(staleness(reportOf(...entries), cases)).toEqual(expected);
    });
});
