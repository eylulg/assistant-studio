import { describe, expect, it } from "vitest";
import { chunkDocument } from "../chunk";

describe("chunkDocument", () => {
    it("returns passages whose offsets slice the document back to exactly the passage text", () => {
        const text = "# Title\n\nFirst paragraph here.\n\nSecond paragraph, a little longer than the first.\n\n\n\nThird after many blank lines.";

        const passages = chunkDocument({ id: "d", text });

        expect(passages.length).toBeGreaterThan(0);
        for (const passage of passages) expect(text.slice(passage.start, passage.end)).toBe(passage.text);
        expect(passages[0]?.text.startsWith("# Title")).toBe(true);
        expect(passages.at(-1)?.text.endsWith("many blank lines.")).toBe(true);
    });

    it("keeps short paragraphs together and starts a new passage once one would grow too long", () => {
        const paragraph = "word ".repeat(30).trim();
        const text = [paragraph, paragraph, paragraph, paragraph].join("\n\n");

        const passages = chunkDocument({ id: "d", text });

        expect(passages.length).toBeGreaterThan(1);
        expect(passages.length).toBeLessThan(4);
        expect(passages.every((passage) => passage.text.length <= 300)).toBe(true);
    });

    it("keeps a heading with the text after it, not at the end of the passage before", () => {
        const body = "Customers can return any product within 30 days of delivery for a full refund. Items must be unused.";
        const text = ["Refunds", body, "Warranty", "All hardware carries a two year warranty."].join("\n\n");

        const passages = chunkDocument({ id: "d", text });

        expect(passages.map((passage) => passage.text.split("\n\n")[0])).toEqual(["Refunds", "Warranty"]);
    });

    it("splits a paragraph that is too long at sentence ends without losing a character of position", () => {
        const sentence = "This sentence has a fixed length of about fifty characters. ";
        const text = sentence.repeat(30).trim();

        const passages = chunkDocument({ id: "d", text });

        expect(passages.length).toBeGreaterThan(2);
        expect(passages.every((passage) => passage.text.length <= 600)).toBe(true);
        expect(passages.every((passage) => passage.text.endsWith("."))).toBe(true);
        for (const passage of passages) expect(text.slice(passage.start, passage.end)).toBe(passage.text);
    });

    it("splits text with no sentence ends at a space, and a word longer than the limit by length", () => {
        const spaced = chunkDocument({ id: "d", text: "alpha ".repeat(300).trim() });
        const unbroken = chunkDocument({ id: "d", text: "x".repeat(1500) });

        expect(spaced.every((passage) => passage.text.length <= 600 && !passage.text.startsWith(" "))).toBe(true);
        expect(unbroken.map((passage) => passage.text.length)).toEqual([600, 600, 300]);
    });

    it("never crosses a page of a PDF and records the page of each passage", () => {
        const text = "Page one text.\n\nMore of page one.\n\nPage two starts here.";
        const second = text.indexOf("Page two");
        const pages = [
            { page: 1, start: 0, end: second - 2 },
            { page: 3, start: second, end: text.length },
        ];

        const passages = chunkDocument({ id: "d", text, pages });

        expect(passages.map((passage) => passage.page)).toEqual([1, 3]);
        expect(passages[0]?.text).toBe("Page one text.\n\nMore of page one.");
        expect(passages[1]?.text).toBe("Page two starts here.");
    });

    it("returns nothing for a document that is only whitespace", () => {
        expect(chunkDocument({ id: "d", text: " \n\n \t " })).toEqual([]);
    });
});
