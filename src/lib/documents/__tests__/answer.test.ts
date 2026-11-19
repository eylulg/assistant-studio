import { describe, expect, it } from "vitest";
import { applyStreamEvent, newAssistantMessage } from "@/lib/chat/reducer";
import { collect } from "@/test-utils/model";
import { composeExtractiveAnswer, streamExtractiveAnswer } from "../answer";

const policy = {
    id: "refunds",
    name: "refunds.txt",
    text: [
        "Refunds",
        "Customers can return any product within 30 days of delivery for a full refund. Items must be unused.",
        "Shipping costs are not refunded unless the item arrived damaged. Report damage with a photo within 7 days.",
        "Warranty",
        "All hardware carries a two year warranty covering manufacturing defects. Water damage is not covered.",
        "Support",
        "Our support team answers email within one business day.",
    ].join("\n\n"),
};

const handbookText = "Travel policy\n\nEconomy flights for trips under six hours.\n\nExpenses\n\nMeals are reimbursed up to 40 euros per day.";
const handbook = {
    id: "handbook",
    name: "handbook.pdf",
    text: handbookText,
    pages: [
        { page: 1, start: 0, end: handbookText.indexOf("Expenses") - 2 },
        { page: 2, start: handbookText.indexOf("Expenses"), end: handbookText.length },
    ],
};

function citations(pieces: ReturnType<typeof composeExtractiveAnswer>) {
    return pieces.flatMap((piece) => (piece.type === "citation" ? [piece.citation] : []));
}

describe("composeExtractiveAnswer", () => {
    it("quotes the best matching passage and every citation range slices the document to the quoted text", () => {
        const pieces = composeExtractiveAnswer("How many days do I have to return a product for a refund?", [policy, handbook]);

        const cited = citations(pieces);

        expect(cited.length).toBeGreaterThanOrEqual(1);
        expect(cited.length).toBeLessThanOrEqual(3);
        expect(cited[0]?.documentId).toBe("refunds");
        expect(cited[0]?.quote).toContain("within 30 days");
        for (const citation of cited) {
            const source = citation.documentId === "refunds" ? policy : handbook;
            expect(source.text.slice(citation.start, citation.end)).toBe(citation.quote);
        }
    });

    it("cites the page of a PDF passage", () => {
        const cited = citations(composeExtractiveAnswer("How much are meals reimbursed per day?", [policy, handbook]));

        expect(cited[0]).toMatchObject({ documentId: "handbook", documentName: "handbook.pdf", startPage: 2, endPage: 2 });
    });

    it("does not quote weak matches just to fill the answer", () => {
        const cited = citations(composeExtractiveAnswer("warranty on hardware", [policy]));

        expect(cited.map((citation) => citation.quote)).toEqual([expect.stringContaining("two year warranty")]);
    });

    it("says nothing was found, cites nothing and names the documents it searched", () => {
        const pieces = composeExtractiveAnswer("Who won the 1998 World Cup?", [policy, handbook]);

        expect(citations(pieces)).toEqual([]);
        expect(pieces).toEqual([{ type: "text", text: expect.stringContaining("refunds.txt, handbook.pdf") }]);
    });

    it("keeps Markdown characters in a quote literal", () => {
        const document = { id: "d", name: "n.md", text: "Use *stars* and # signs and [brackets] in the manual." };

        const text = composeExtractiveAnswer("manual stars", [document])
            .flatMap((piece) => (piece.type === "text" ? [piece.text] : []))
            .join("");

        expect(text).toContain("\\*stars\\*");
        expect(text).toContain("\\#");
        expect(text).toContain("\\[brackets\\]");
    });
});

describe("streamExtractiveAnswer", () => {
    it("streams through the events a model answer uses and the reducer places each citation at the end of its quote", async () => {
        const events = await collect(streamExtractiveAnswer("How long is the warranty?", [policy], { paceScale: 0 }));

        const message = events.reduce(applyStreamEvent, newAssistantMessage("a", "claude-sonnet-5-5", "2026-11-10T09:30:00.000Z"));

        expect(events[0]).toEqual({ type: "answer_mode", mode: "extractive" });
        expect(events.at(-1)).toEqual({ type: "done", reason: "end_turn" });
        expect(message.mode).toBe("extractive");
        expect(message.status).toBe("complete");
        const part = message.parts[0];
        if (part?.type !== "text" || part.citations?.length !== 1 || !part.citations[0]) throw new Error("expected a text part with one citation");
        expect(part.text.slice(0, part.citations[0].at)).toMatch(/Water damage is not covered\.$/);
    });

    it("stops when the signal aborts between chunks", async () => {
        const controller = new AbortController();
        const stream = streamExtractiveAnswer("warranty", [policy], { signal: controller.signal });

        const first = await stream.next();
        controller.abort();

        expect(first.done).toBe(false);
        await expect(collect(stream)).rejects.toMatchObject({ name: "AbortError" });
    });
});
