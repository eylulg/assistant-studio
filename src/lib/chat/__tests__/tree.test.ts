import { describe, expect, it } from "vitest";
import { newAssistantMessage } from "../reducer";
import { activePath, appendMessage, childrenOf, createConversation, forkUserMessage, pathTo, selectVersion, updateAssistant, versionsOf } from "../tree";
import type { Conversation, UserMessage } from "../types";

const user = (id: string, text: string): UserMessage => ({ role: "user", id, text, createdAt: "t" });
const assistantMessage = (id: string) => newAssistantMessage(id, "claude-sonnet-5-5", "t");
const NOW = "2026-11-10T09:30:00.000Z";

/** u1 > a1 > u2 > a2 */
function twoTurns(): Conversation {
    let conversation = createConversation("c1", NOW);
    conversation = appendMessage(conversation, null, user("u1", "First question"), NOW);
    conversation = appendMessage(conversation, "u1", assistantMessage("a1"), NOW);
    conversation = appendMessage(conversation, "a1", user("u2", "Second question"), NOW);
    return appendMessage(conversation, "u2", assistantMessage("a2"), NOW);
}

const ids = (conversation: Conversation) => activePath(conversation).map((node) => node.id);

describe("conversation tree", () => {
    it("shows the whole chain, titled after the first message", () => {
        const conversation = twoTurns();

        expect(ids(conversation)).toEqual(["u1", "a1", "u2", "a2"]);
        expect(conversation.title).toBe("First question");
    });

    it("forks an earlier message into a sibling and shows the new branch, keeping the old one reachable", () => {
        const forked = forkUserMessage(twoTurns(), "u1", user("u1b", "First question, reworded"), NOW);

        expect(ids(forked)).toEqual(["u1b"]);
        expect(versionsOf(forked, "u1b")).toEqual({ index: 1, count: 2, previousId: "u1", nextId: undefined });

        const back = selectVersion(forked, "u1");
        expect(ids(back)).toEqual(["u1", "a1", "u2", "a2"]);
        expect(versionsOf(back, "u1")).toMatchObject({ index: 0, count: 2, nextId: "u1b" });
    });

    it("remembers which version was chosen at each step independently", () => {
        let conversation = twoTurns();
        conversation = appendMessage(conversation, "u2", assistantMessage("a2b"), NOW);
        conversation = forkUserMessage(conversation, "u2", user("u2b", "Second question, reworded"), NOW);
        conversation = appendMessage(conversation, "u2b", assistantMessage("a3"), NOW);

        expect(ids(conversation)).toEqual(["u1", "a1", "u2b", "a3"]);
        expect(ids(selectVersion(conversation, "u2"))).toEqual(["u1", "a1", "u2", "a2b"]);
        expect(ids(selectVersion(selectVersion(conversation, "u2"), "a2"))).toEqual(["u1", "a1", "u2", "a2"]);
    });

    it("adds a regenerated answer as a sibling of the old one", () => {
        const regenerated = appendMessage(twoTurns(), "u2", assistantMessage("a2b"), NOW);

        expect(childrenOf(regenerated, "u2").map((node) => node.id)).toEqual(["a2", "a2b"]);
        expect(ids(regenerated).at(-1)).toBe("a2b");
    });

    it("lists the path to a message whichever branch is showing, and ignores unknown ids", () => {
        const forked = forkUserMessage(twoTurns(), "u2", user("u2b", "Other"), NOW);

        expect(pathTo(forked, "a2").map((node) => node.id)).toEqual(["u1", "a1", "u2", "a2"]);
        expect(selectVersion(forked, "nope")).toBe(forked);
        expect(forkUserMessage(forked, "a1", user("x", "x"), NOW)).toBe(forked);
    });

    it("updates only an assistant message", () => {
        const updated = updateAssistant(twoTurns(), "a1", (message) => ({ ...message, status: "complete" }));

        expect(updated.nodes["a1"]?.message).toMatchObject({ status: "complete" });
        expect(updateAssistant(updated, "u1", (message) => ({ ...message, status: "error" }))).toBe(updated);
    });
});
