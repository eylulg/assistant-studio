import { z } from 'zod';

export const CHECK_TYPES = ['tools', 'answer', 'tasks', 'citations'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

const caseResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  prompt: z.string(),
  status: z.enum(['pass', 'fail', 'skipped']),
  tools: z.array(z.string()),
  checks: z.array(
    z.object({
      name: z.string(),
      type: z.enum(CHECK_TYPES),
      passed: z.boolean(),
      detail: z.string(),
    }),
  ),
  chars: z.number().nonnegative(),
  /** Input, cache and output tokens of the answer. For a fixture run these are the usage figures stored in the recording. */
  tokens: z.number().nonnegative(),
  /** An estimate from list prices. */
  costUsd: z.number().nonnegative(),
  note: z.string().optional(),
});

/**
 * What one run of the eval suite wrote to `evals/reports`. A fixture report replays recordings, needs no key and has no
 * timestamp, so running it again on the same code gives the same file. A live report is a run against the real API.
 */
export const evalReportSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['fixture', 'live']),
  model: z.string(),
  /** Live reports only. */
  generatedAt: z.string().optional(),
  cases: z.array(caseResultSchema),
});

export type EvalReport = z.infer<typeof evalReportSchema>;
export type CaseResult = EvalReport['cases'][number];

/**
 * Compares a report with the cases the suite has now. An empty list means the report still describes this suite. It
 * catches a case that was added, removed, renamed or given a new prompt without the report being regenerated.
 */
export function staleness(
  report: EvalReport,
  cases: readonly { id: string; prompt: string }[],
): string[] {
  const problems: string[] = [];
  const reported = new Map(report.cases.map((result) => [result.id, result]));
  const current = new Set(cases.map((testCase) => testCase.id));

  for (const testCase of cases) {
    const result = reported.get(testCase.id);
    if (!result) problems.push(`${testCase.id} is not in the report`);
    else if (result.prompt !== testCase.prompt)
      problems.push(`${testCase.id} has a different prompt now`);
  }
  for (const result of report.cases)
    if (!current.has(result.id))
      problems.push(`${result.id} is in the report but no longer a case`);
  return problems;
}
