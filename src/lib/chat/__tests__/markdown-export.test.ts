import { describe, expect, it } from "vitest";
import { conversationToMarkdown } from "../markdown-export";
import { applyStreamEvent, newAssistantMessage, stopMessage } from "../reducer";
import { appendMessage, createConversation, forkUserMessage, selectVersion } from "../tree";

const NOW = "2026-11-10T09:30:00.000Z";

function conversation() {
    let result = createConversation("c1", NOW);
    result = appendMessage(result, null, { role: "user", id: "u1", text: "What is 2 + 2?", createdAt: NOW }, NOW);
    const answer = [
        { type: "round_start" as const },
        { type: "text" as const, text: "Let me check." },
        { type: "tool_start" as const, id: "t1", name: "calculate" },
        { type: "tool_call" as const, id: "t1", name: "calculate", input: { expression: "2+2" } },
        { type: "tool_result" as const, id: "t1", ok: true, output: '{"result":4}', durationMs: 2 },
        { type: "round_start" as const },
        { type: "text" as const, text: "It is **4**." },
        { type: "usage" as const, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
        { type: "done" as const, reason: "end_turn" as const },
    ].reduce(applyStreamEvent, newAssistantMessage("a1", "claude-sonnet-5-5", NOW));
    return appendMessage(result, "u1", answer, NOW);
}

describe("conversationToMarkdown", () => {
    it("writes the visible branch with tool calls and their results", () => {
        expect(conversationToMarkdown(conversation())).toBe(`# What is 2 + 2?

## You

What is 2 + 2?

## Assistant

Let me check.

> **Tool call: calculate** (done, 2 ms)

\`\`\`json
{
  "expression": "2+2"
}
\`\`\`

Result:

\`\`\`json
{
  "result": 4
}
\`\`\`

It is **4**.

_Claude Sonnet 5.5, 100 input and 20 output tokens, about <$0.01_
`);
    });

    it("exports the branch that is showing, and notes a stopped answer", () => {
        let forked = forkUserMessage(conversation(), "u1", { role: "user", id: "u1b", text: "Reworded", createdAt: NOW }, NOW);
        forked = appendMessage(
            forked,
            "u1b",
            stopMessage({ ...newAssistantMessage("a2", "claude-sonnet-5-5", NOW), parts: [{ type: "text", round: 0, text: "Starting" }] }),
            NOW,
        );

        const markdown = conversationToMarkdown(forked);

        expect(markdown).toContain("Reworded");
        expect(markdown).toContain("_Stopped by the user._");
        expect(markdown).not.toContain("What is 2 + 2?\n\n## Assistant");
        expect(conversationToMarkdown(selectVersion(forked, "u1"))).toContain("It is **4**.");
    });
});
