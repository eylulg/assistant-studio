import { z } from "zod";
import type { Task } from "@/lib/tools/types";

export interface ToolExpectation {
    name: string;
    /** The tool's input must satisfy this schema. Extra keys are fine. */
    input?: z.ZodType;
    /** The tool must end in this state. Defaults to done. */
    status?: "done" | "denied" | "error";
}

export interface EvalCase {
    id: string;
    prompt: string;
    /** Task list at the start of the conversation. */
    tasks?: Task[];
    /** What the simulated user does at an approval step. Defaults to approve. */
    approval?: "approve" | "deny";
    /**
     * Documents the question is about, by eval fixture id. `extractive` runs the browser-side answer, which needs no
     * transcript and no key. `model` runs through the engine: an authored transcript when replaying, the API when live.
     */
    documents?: { ids: string[]; via: "extractive" | "model" };
    expect: {
        /** Every expectation must be matched by a different call. Any call outside this list fails the case. */
        tools: ToolExpectation[];
        /** The expected calls came in this order. */
        ordered?: boolean;
        /** At least this many calls came from one model round, so they ran in parallel. */
        parallelCalls?: number;
        answer: {
            contains?: (string | RegExp)[];
            notContains?: (string | RegExp)[];
            maxChars?: number;
            /** The answer cites this note as [note-06] and a search result actually contained it. */
            citesNote?: string;
        };
        /** Tasks in the list at the end. */
        taskCount?: number;
        /** For document cases. Every citation is also checked against its document, whatever is listed here. */
        citations?: {
            /** Each of these documents is cited at least once. */
            documents?: string[];
            /** Each pattern matches the text of at least one cited quote. */
            quotes?: (string | RegExp)[];
            /** Some citation is on this page of a PDF. */
            page?: number;
            /** The answer cites nothing, because the documents do not contain it. */
            none?: boolean;
        };
    };
}

const PASSPORT: Task = { id: "task-1", title: "Renew passport", due: "2026-12-01", priority: "high", done: false, createdAt: "2026-11-10T09:30:00.000Z" };

export const CASES: EvalCase[] = [
    {
        id: "calc-basic",
        prompt: "What is 18% of 2,450, plus 75?",
        expect: {
            tools: [{ name: "calculate", input: z.object({ expression: z.string().regex(/2450/) }) }],
            answer: { contains: ["516"], maxChars: 400 },
        },
    },
    {
        id: "convert-units-parallel",
        prompt: "How many miles is a 10 km run, and how many pounds is 72 kg?",
        expect: {
            tools: [
                { name: "convert_units", input: z.object({ value: z.literal(10), from: z.string().regex(/^km|kilomet/i), to: z.string().regex(/^mi/i) }) },
                {
                    name: "convert_units",
                    input: z.object({ value: z.literal(72), from: z.string().regex(/^kg|kilogram/i), to: z.string().regex(/^lb|pound/i) }),
                },
            ],
            parallelCalls: 2,
            answer: { contains: ["6.2", "158.7"], maxChars: 500 },
        },
    },
    {
        id: "time-zone",
        prompt: "What time is it in Tokyo right now?",
        expect: {
            tools: [{ name: "get_time", input: z.object({ timezone: z.literal("Asia/Tokyo") }) }],
            answer: { contains: ["Tokyo", /\d{1,2}:\d{2}/], maxChars: 400 },
        },
    },
    {
        id: "notes-search-cites",
        prompt: "Do I have a lentil soup recipe in my notes? What goes in it?",
        expect: {
            tools: [{ name: "search_notes", input: z.object({ query: z.string().regex(/lentil/i) }) }],
            answer: { contains: [/cumin/i], citesNote: "note-06", maxChars: 700 },
        },
    },
    {
        id: "create-task-approved",
        prompt: "Add a task to renew my passport by 2026-12-01, high priority.",
        expect: {
            tools: [
                {
                    name: "create_task",
                    input: z.object({ title: z.string().regex(/passport/i), due: z.literal("2026-12-01"), priority: z.literal("high") }),
                    status: "done",
                },
            ],
            taskCount: 1,
            answer: { notContains: [/denied/i], maxChars: 300 },
        },
    },
    {
        id: "create-task-denied",
        prompt: "Add a task to renew my passport by 2026-12-01, high priority.",
        approval: "deny",
        expect: {
            tools: [{ name: "create_task", input: z.object({ title: z.string().regex(/passport/i) }), status: "denied" }],
            taskCount: 0,
            answer: {
                contains: [/won't|will not|not add|understood|no problem/i],
                notContains: [/i added|has been added|is now in your list/i],
                maxChars: 300,
            },
        },
    },
    {
        id: "list-tasks",
        prompt: "What tasks do I have open?",
        tasks: [PASSPORT],
        expect: {
            tools: [{ name: "list_tasks", input: z.object({ status: z.enum(["open", "all"]).optional() }) }],
            answer: { contains: [/passport/i], maxChars: 400 },
            taskCount: 1,
        },
    },
    {
        id: "weather-sample-parallel",
        prompt: "What's the weather like in Oslo and Lisbon?",
        expect: {
            tools: [
                { name: "lookup_weather", input: z.object({ city: z.string().regex(/oslo/i) }) },
                { name: "lookup_weather", input: z.object({ city: z.string().regex(/lisbon/i) }) },
            ],
            parallelCalls: 2,
            answer: { contains: ["Oslo", "Lisbon", /sample/i], maxChars: 600 },
        },
    },
    {
        id: "parallel-mixed",
        prompt: "Is it warmer in Istanbul or Amsterdam right now, and what time is it in Istanbul?",
        expect: {
            tools: [
                { name: "lookup_weather", input: z.object({ city: z.string().regex(/istanbul/i) }) },
                { name: "lookup_weather", input: z.object({ city: z.string().regex(/amsterdam/i) }) },
                { name: "get_time", input: z.object({ timezone: z.literal("Europe/Istanbul") }) },
            ],
            parallelCalls: 3,
            answer: { contains: ["Istanbul", /sample/i], maxChars: 600 },
        },
    },
    {
        id: "no-tool-needed",
        prompt: "In one sentence, what does a mutex do?",
        expect: { tools: [], answer: { contains: [/thread|process|lock|exclusive/i], maxChars: 300 } },
    },
    {
        id: "markdown-code",
        prompt: "Show me a TypeScript debounce function.",
        expect: { tools: [], answer: { contains: ["```", /debounce/i] } },
    },
    {
        id: "chain-search-then-task",
        prompt: "Find my Kyoto notes and add a task to book the tea ceremony.",
        expect: {
            tools: [
                { name: "search_notes", input: z.object({ query: z.string().regex(/kyoto/i) }) },
                { name: "create_task", input: z.object({ title: z.string().regex(/tea ceremony/i) }), status: "done" },
            ],
            ordered: true,
            taskCount: 1,
            answer: { citesNote: "note-17", maxChars: 500 },
        },
    },
    {
        id: "tool-error-recovery",
        prompt: "How many cups is 3 kilometres?",
        expect: {
            tools: [{ name: "convert_units", status: "error" }],
            answer: { contains: [/length|distance/i, /volume/i], notContains: [/\d[\d,.]*\s*cups/i], maxChars: 500 },
        },
    },
    {
        id: "docs-refund-window",
        prompt: "How many days do customers have to return a product?",
        documents: { ids: ["refund-policy"], via: "extractive" },
        expect: {
            tools: [],
            citations: { documents: ["refund-policy"], quotes: [/within 30 days of delivery/] },
            answer: { contains: ["30 days"] },
        },
    },
    {
        id: "docs-pdf-page",
        prompt: "How much are meals reimbursed per day while travelling?",
        documents: { ids: ["refund-policy", "travel-handbook"], via: "extractive" },
        expect: {
            tools: [],
            citations: { documents: ["travel-handbook"], quotes: [/40 euros per day/], page: 2 },
            answer: { contains: ["travel-handbook.pdf, page 2"] },
        },
    },
    {
        id: "docs-emoji-offsets",
        prompt: "When are the retrospectives held?",
        documents: { ids: ["team-notes"], via: "extractive" },
        expect: {
            tools: [],
            citations: { documents: ["team-notes"], quotes: [/every second Thursday at 15:00/] },
            answer: { contains: ["second Thursday"] },
        },
    },
    {
        id: "docs-not-in-documents",
        prompt: "Who won the 1998 World Cup?",
        documents: { ids: ["refund-policy", "travel-handbook"], via: "extractive" },
        expect: {
            tools: [],
            citations: { none: true },
            answer: { contains: ["Nothing in your documents matches"], notContains: [/France|Brazil/] },
        },
    },
    {
        id: "docs-warranty-model-cited",
        prompt: "What does the warranty cover, and what does it leave out?",
        documents: { ids: ["refund-policy"], via: "model" },
        expect: {
            tools: [],
            citations: { documents: ["refund-policy"], quotes: [/two year warranty/, /Water damage/] },
            answer: { contains: [/two years/i, /water damage/i], maxChars: 400 },
        },
    },
    {
        id: "docs-meals-page-cited",
        prompt: "How much are meals reimbursed per day, and by when are receipts due?",
        documents: { ids: ["travel-handbook"], via: "model" },
        expect: {
            tools: [],
            citations: { documents: ["travel-handbook"], quotes: [/40 euros/, /14 days/], page: 2 },
            answer: { contains: ["40 euros", "14 days"], maxChars: 300 },
        },
    },
];
