import { describe, expect, it } from "vitest";
import { demoTranscripts } from "@/lib/engine/demo";
import { createReplayClient } from "@/lib/engine/replay-client";
import { CASES } from "./cases";
import { runCase } from "./harness";
import { buildTranscript, createRecorder, transcriptIndexSource } from "./recorder";

describe("recording", () => {
    it("writes a transcript that replays to the same answer, tool calls and result", async () => {
        const testCase = CASES.find((entry) => entry.id === "chain-search-then-task");
        if (!testCase) throw new Error("missing case");
        const original = createRecorder(createReplayClient(demoTranscripts, { paceScale: 0 }));
        const first = await runCase(testCase, { client: original.client, model: "claude-sonnet-5-5", clock: "frozen" });

        const transcript = buildTranscript({
            prompt: testCase.prompt,
            model: "claude-sonnet-5-5",
            rounds: original.rounds,
            suggested: false,
            date: "2026-11-10",
        });
        const second = await runCase(testCase, { client: createReplayClient([transcript], { paceScale: 0 }), model: "claude-sonnet-5-5", clock: "frozen" });

        expect(transcript).toMatchObject({ id: "find-my-kyoto-notes-and-add-a-task-to-book-the-t", source: "recorded" });
        expect(second.text).toBe(first.text);
        expect(second.tools.map((tool) => [tool.name, tool.input, tool.output])).toEqual(first.tools.map((tool) => [tool.name, tool.input, tool.output]));
    });

    it("lists every recording in the index module, in order", () => {
        expect(transcriptIndexSource(["tool-error", "calc-basic", "2fa-codes"])).toBe(
            'import _2faCodes from "./2fa-codes.json";\nimport calcBasic from "./calc-basic.json";\nimport toolError from "./tool-error.json";\n\nconst transcripts: unknown[] = [_2faCodes, calcBasic, toolError];\n\nexport default transcripts;\n',
        );
    });
});
