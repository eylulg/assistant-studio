import Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { createAnthropicClient } from "@/lib/engine/anthropic-client";
import { demoTranscripts } from "@/lib/engine/demo";
import { createReplayClient, findTranscript } from "@/lib/engine/replay-client";
import { DEFAULT_MODEL, estimateCostUsd } from "@/lib/models";
import { CASES } from "./cases";
import { evaluateCase } from "./checks";
import { runCase } from "./harness";
import { type ReportRow, formatReport } from "./report";

const live = process.env.EVAL_MODE === "live";
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const budgetUsd = Number(process.env.EVAL_BUDGET_USD ?? "0.5");
const model = process.env.EVAL_MODEL ?? DEFAULT_MODEL;

if (live && !hasKey) console.log("\nANTHROPIC_API_KEY is not set, so the live evals are skipped. The fixture evals (npm run eval) need no key.\n");

describe.skipIf(live && !hasKey)(`assistant evals (${live ? `live, ${model}` : "recorded transcripts"})`, () => {
    const rows: ReportRow[] = [];
    let spent = 0;

    afterAll(() => {
        process.stdout.write(
            formatReport(live ? `Live eval report, ${model}, budget $${budgetUsd.toFixed(2)}` : "Eval report, recorded transcripts replayed", rows),
        );
    });

    if (!live) {
        it("has a recording for every case", () => {
            const missing = CASES.filter((testCase) => !findTranscript(demoTranscripts, testCase.prompt)).map((testCase) => testCase.id);

            expect(missing).toEqual([]);
        });
    }

    it.each(CASES)("$id", async (testCase) => {
        if (live && spent >= budgetUsd) {
            rows.push({
                id: testCase.id,
                status: "skipped",
                tools: "",
                checks: "",
                chars: 0,
                tokens: 0,
                costUsd: 0,
                note: `budget of $${budgetUsd.toFixed(2)} reached before this case`,
            });
            return;
        }

        const client = live ? createAnthropicClient(new Anthropic(), "medium") : createReplayClient(demoTranscripts, { paceScale: 0 });
        const run = await runCase(testCase, { client, model, clock: live ? "system" : "frozen", maxOutputTokens: live ? 2048 : 4096 });
        const costUsd = estimateCostUsd(model, run.message.usage);
        spent += costUsd;

        const checks = evaluateCase(testCase, run);
        const failed = checks.filter((check) => !check.passed);
        rows.push({
            id: testCase.id,
            status: failed.length === 0 ? "pass" : "fail",
            tools: run.tools.map((tool) => tool.name).join(", "),
            checks: `${checks.length - failed.length}/${checks.length}`,
            chars: run.text.length,
            tokens: run.message.usage.inputTokens + run.message.usage.cacheReadTokens + run.message.usage.cacheWriteTokens + run.message.usage.outputTokens,
            costUsd,
            note: failed.map((check) => `${check.name}${check.detail ? ` (${check.detail})` : ""}`).join("; ") || undefined,
        });

        expect(failed.map((check) => `${check.name}: ${check.detail}`)).toEqual([]);
    });
});
