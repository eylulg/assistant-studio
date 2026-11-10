import type { EvalCase, ToolExpectation } from "./cases";
import type { RunResult } from "./harness";

export interface Check {
    name: string;
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
            checks.push({ name: `tool: ${wanted.name}`, passed: false, detail: reason });
            continue;
        }
        used.add(index);
        order.push(index);
        const call = calls[index];
        const wantedStatus = wanted.status ?? "done";
        checks.push({ name: `tool: ${describe(wanted)}`, passed: call?.status === wantedStatus, detail: `status ${call?.status}, expected ${wantedStatus}` });
    }

    const unexpected = calls.filter((_, position) => !used.has(position)).map((call) => call.name);
    checks.push({ name: "no unexpected tools", passed: unexpected.length === 0, detail: unexpected.length ? `also called ${unexpected.join(", ")}` : "none" });

    if (ordered)
        checks.push({
            name: "tool order",
            passed: order.every((value, position) => position === 0 || value > (order[position - 1] ?? -1)),
            detail: calls.map((call) => call.name).join(" then "),
        });

    if (testCase.expect.parallelCalls) {
        const perRound = new Map<number, number>();
        for (const call of calls) perRound.set(call.round, (perRound.get(call.round) ?? 0) + 1);
        const most = Math.max(0, ...perRound.values());
        checks.push({
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

    for (const pattern of answer.contains ?? []) checks.push({ name: `contains ${label(pattern)}`, passed: matches(text, pattern), detail: "" });
    for (const pattern of answer.notContains ?? []) checks.push({ name: `not contains ${label(pattern)}`, passed: !matches(text, pattern), detail: "" });
    if (answer.maxChars !== undefined)
        checks.push({ name: `at most ${answer.maxChars} characters`, passed: text.length <= answer.maxChars, detail: `${text.length} characters` });
    if (answer.citesNote) {
        const cited = text.includes(`[${answer.citesNote}]`);
        const grounded = run.tools.some((tool) => tool.name === "search_notes" && tool.output?.includes(`"${answer.citesNote}"`));
        checks.push({
            name: `cites ${answer.citesNote}`,
            passed: cited && grounded,
            detail: !cited ? "no citation in the answer" : !grounded ? "the search never returned that note" : "",
        });
    }
    if (testCase.expect.taskCount !== undefined)
        checks.push({
            name: `${testCase.expect.taskCount} task(s) in the list`,
            passed: run.tasks.length === testCase.expect.taskCount,
            detail: `${run.tasks.length} found`,
        });
    return checks;
}

export function evaluateCase(testCase: EvalCase, run: RunResult): Check[] {
    return [...toolChecks(testCase, run), ...answerChecks(testCase, run)];
}
