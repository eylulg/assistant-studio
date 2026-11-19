import { locateCitation } from "@/lib/documents/locate";
import type { CheckType } from "@/lib/insights/eval-report";
import type { EvalCase, ToolExpectation } from "./cases";
import { fixture } from "./documents/fixtures";
import type { RunResult } from "./harness";

export interface Check {
    name: string;
    type: CheckType;
    passed: boolean;
    detail: string;
}

function matches(text: string, pattern: string | RegExp): boolean {
    return typeof pattern === "string" ? text.toLowerCase().includes(pattern.toLowerCase()) : pattern.test(text);
}

function label(pattern: string | RegExp): string {
    return typeof pattern === "string" ? `"${pattern}"` : String(pattern);
}

function toolChecks(testCase: EvalCase, run: RunResult): Check[] {
    const { tools: expected, ordered } = testCase.expect;
    const calls = run.tools.filter((tool) => tool.input !== undefined || tool.status !== "streaming");
    const checks: Check[] = [];
    const used = new Set<number>();
    const order: number[] = [];

    for (const wanted of expected) {
        const index = calls.findIndex(
            (call, position) => !used.has(position) && call.name === wanted.name && (!wanted.input || wanted.input.safeParse(call.input).success),
        );
        if (index === -1) {
            const sameName = calls.find((call) => call.name === wanted.name);
            const reason = !sameName ? `${wanted.name} was not called` : `${wanted.name} was called with ${JSON.stringify(sameName.input)}`;
            checks.push({ type: "tools", name: `tool: ${wanted.name}`, passed: false, detail: reason });
            continue;
        }
        used.add(index);
        order.push(index);
        const call = calls[index];
        const wantedStatus = wanted.status ?? "done";
        checks.push({
            type: "tools",
            name: `tool: ${describe(wanted)}`,
            passed: call?.status === wantedStatus,
            detail: `status ${call?.status}, expected ${wantedStatus}`,
        });
    }

    const unexpected = calls.filter((_, position) => !used.has(position)).map((call) => call.name);
    checks.push({
        type: "tools",
        name: "no unexpected tools",
        passed: unexpected.length === 0,
        detail: unexpected.length ? `also called ${unexpected.join(", ")}` : "none",
    });

    if (ordered)
        checks.push({
            type: "tools",
            name: "tool order",
            passed: order.every((value, position) => position === 0 || value > (order[position - 1] ?? -1)),
            detail: calls.map((call) => call.name).join(" then "),
        });

    if (testCase.expect.parallelCalls) {
        const perRound = new Map<number, number>();
        for (const call of calls) perRound.set(call.round, (perRound.get(call.round) ?? 0) + 1);
        const most = Math.max(0, ...perRound.values());
        checks.push({
            type: "tools",
            name: `parallel calls (${testCase.expect.parallelCalls})`,
            passed: most >= testCase.expect.parallelCalls,
            detail: `${most} in one round`,
        });
    }
    return checks;
}

function describe(wanted: ToolExpectation): string {
    return wanted.status && wanted.status !== "done" ? `${wanted.name} (${wanted.status})` : wanted.name;
}

function answerChecks(testCase: EvalCase, run: RunResult): Check[] {
    const { answer } = testCase.expect;
    const text = run.text;
    const checks: Check[] = [];

    for (const pattern of answer.contains ?? [])
        checks.push({ type: "answer", name: `contains ${label(pattern)}`, passed: matches(text, pattern), detail: "" });
    for (const pattern of answer.notContains ?? [])
        checks.push({ type: "answer", name: `not contains ${label(pattern)}`, passed: !matches(text, pattern), detail: "" });
    if (answer.maxChars !== undefined)
        checks.push({
            type: "answer",
            name: `at most ${answer.maxChars} characters`,
            passed: text.length <= answer.maxChars,
            detail: `${text.length} characters`,
        });
    if (answer.citesNote) {
        const cited = text.includes(`[${answer.citesNote}]`);
        const grounded = run.tools.some((tool) => tool.name === "search_notes" && tool.output?.includes(`"${answer.citesNote}"`));
        checks.push({
            type: "answer",
            name: `cites ${answer.citesNote}`,
            passed: cited && grounded,
            detail: !cited ? "no citation in the answer" : !grounded ? "the search never returned that note" : "",
        });
    }
    if (testCase.expect.taskCount !== undefined)
        checks.push({
            type: "tasks",
            name: `${testCase.expect.taskCount} task(s) in the list`,
            passed: run.tasks.length === testCase.expect.taskCount,
            detail: `${run.tasks.length} found`,
        });
    return checks;
}

function squeeze(text: string): string {
    return text.replace(/\\/g, "").replace(/^> ?/gm, "").replace(/\s+/g, " ").trim();
}

/** What every answer built from documents has to satisfy, whatever it says: its citations point at real text in the documents it was given. */
function documentChecks(testCase: EvalCase, run: RunResult): Check[] {
    if (!testCase.documents) return [];
    const supplied = testCase.documents.ids.map(fixture);
    const wanted = testCase.expect.citations;
    const checks: Check[] = [];

    const outside: string[] = [];
    const mismatched: string[] = [];
    for (const citation of run.citations) {
        const document = supplied.find((candidate) => candidate.id === citation.documentId);
        if (!document) {
            outside.push(`${citation.documentName} was not supplied`);
            continue;
        }
        const { start, end, startPage, endPage } = citation;
        const pagesOk = startPage === undefined || (document.pages ?? []).some((span) => span.page === startPage) || false;
        const rangeOk = start === undefined || end === undefined || (start >= 0 && start < end && end <= document.text.length);
        if (!pagesOk || !rangeOk || (endPage !== undefined && startPage !== undefined && endPage < startPage))
            outside.push(`${citation.documentName} ${start === undefined ? `page ${startPage}` : `${start} to ${end}`}`);
        else if (start !== undefined && end !== undefined && document.text.slice(start, end) !== citation.quote)
            mismatched.push(`${citation.documentName} ${start} to ${end}`);
        else if (start === undefined && !locateCitation(document, citation)) mismatched.push(`${citation.documentName} page ${startPage}`);
    }
    checks.push({
        type: "citations",
        name: "every citation points inside its document",
        passed: outside.length === 0,
        detail: outside.length ? outside.join("; ") : `${run.citations.length} checked`,
    });
    checks.push({
        type: "citations",
        name: "every quote matches the source at its range",
        passed: mismatched.length === 0,
        detail: mismatched.length ? mismatched.join("; ") : `${run.citations.length} checked`,
    });

    if (testCase.documents.via === "extractive") {
        const answer = squeeze(run.text);
        const missing = run.citations.filter((citation) => !answer.includes(squeeze(citation.quote)));
        checks.push({
            type: "citations",
            name: "the answer shows each quote it cites",
            passed: missing.length === 0,
            detail: missing.length ? `${missing.length} not in the answer text` : "",
        });
        checks.push({
            type: "answer",
            name: "answered without a model",
            passed: run.message.mode === "extractive" && run.message.usage.inputTokens + run.message.usage.outputTokens === 0,
            detail: `mode ${run.message.mode ?? "model"}`,
        });
    }

    if (wanted?.none)
        checks.push({ type: "citations", name: "cites nothing", passed: run.citations.length === 0, detail: `${run.citations.length} citations` });
    else if (wanted) checks.push({ type: "citations", name: "cites something", passed: run.citations.length > 0, detail: "no citations" });
    for (const id of wanted?.documents ?? []) {
        const name = fixture(id).name;
        checks.push({ type: "citations", name: `cites ${name}`, passed: run.citations.some((citation) => citation.documentId === id), detail: "" });
    }
    for (const pattern of wanted?.quotes ?? [])
        checks.push({
            type: "citations",
            name: `a quote matches ${label(pattern)}`,
            passed: run.citations.some((citation) => matches(citation.quote, pattern)),
            detail: "",
        });
    if (wanted?.page !== undefined)
        checks.push({
            type: "citations",
            name: `cites page ${wanted.page}`,
            passed: run.citations.some((citation) => citation.startPage === wanted.page),
            detail: `pages cited: ${run.citations.map((citation) => citation.startPage ?? "-").join(", ")}`,
        });
    return checks;
}

export function evaluateCase(testCase: EvalCase, run: RunResult): Check[] {
    return [...toolChecks(testCase, run), ...answerChecks(testCase, run), ...documentChecks(testCase, run)];
}
