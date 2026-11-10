import { describe, expect, it } from "vitest";
import { demoTranscripts } from "../engine/demo";
import { findTranscript } from "../engine/replay-client";
import { SUGGESTED_PROMPTS } from "../suggestions";

describe("suggested prompts", () => {
    it("each have an exact recording, so every example works in demo mode", () => {
        const withoutRecording = SUGGESTED_PROMPTS.filter((prompt) => findTranscript(demoTranscripts, prompt)?.prompt !== prompt);

        expect(withoutRecording).toEqual([]);
    });

    it("are exactly the recordings marked as suggested", () => {
        const marked = demoTranscripts.filter((transcript) => transcript.suggested).map((transcript) => transcript.prompt);

        expect([...marked].sort()).toEqual([...SUGGESTED_PROMPTS].sort());
    });
});
