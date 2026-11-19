import { describe, expect, it } from "vitest";
import { rankPassages, tokenize } from "../bm25";
import type { Passage } from "../types";

function passage(text: string, start = 0): Passage {
    return { documentId: "d", start, end: start + text.length, text };
}

describe("tokenize", () => {
    it("lowercases, keeps letters and digits from any script, and drops stop words and single letters", () => {
        expect(tokenize("What is the Refund-window for Istanbul orders, 30 days? A b")).toEqual(["refund", "window", "istanbul", "orders", "30", "days"]);
    });
});

describe("rankPassages", () => {
    const passages = [
        passage("Customers can return any product within 30 days of delivery for a full refund.", 0),
        passage("All hardware carries a two year warranty covering manufacturing defects.", 100),
        passage("Shipping costs are not refunded unless the item arrived damaged.", 200),
    ];

    it("puts the passage that answers the question first and leaves out passages that share no term", () => {
        const ranked = rankPassages("How long is the warranty on hardware?", passages);

        expect(ranked.map((entry) => entry.passage.start)).toEqual([100]);
    });

    it("scores a rare term above a common one", () => {
        const corpus = [passage("refund refund policy applies", 0), passage("the policy policy policy of the company", 100), passage("policy of returns", 200)];

        const ranked = rankPassages("refund policy", corpus);

        expect(ranked[0]?.passage.start).toBe(0);
    });

    it("prefers the shorter passage when two match equally often", () => {
        const corpus = [passage("deposit " + "filler ".repeat(40), 0), passage("deposit due on arrival", 100)];

        const ranked = rankPassages("deposit", corpus);

        expect(ranked.map((entry) => entry.passage.start)).toEqual([100, 0]);
    });

    it("keeps document order for equal scores, so the answer does not depend on map order", () => {
        const corpus = [passage("tea", 50), passage("tea", 10)];

        expect(rankPassages("tea", corpus).map((entry) => entry.passage.start)).toEqual([10, 50]);
    });

    it.each([
        ["a question made only of stop words", "what is the", passages],
        ["an empty question", "  ", passages],
        ["no passages", "refund", []],
    ])("returns nothing for %s", (_name, question, corpus) => {
        expect(rankPassages(question, corpus)).toEqual([]);
    });
});
