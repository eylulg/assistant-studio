import { CHECK_TYPES, type CaseResult, type CheckType, type EvalReport } from './eval-report';
import type { EvalFilters } from './filters';

export const CHECK_TYPE_LABEL: Record<CheckType, string> = {
  tools: 'Tool calls',
  answer: 'Answer',
  tasks: 'Task list',
  citations: 'Citations',
};

/** The cases that used at least one of the chosen tools. With no tool chosen, every case. */
export function filterCases(report: EvalReport, tools: readonly string[]): CaseResult[] {
  if (tools.length === 0) return report.cases;
  const wanted = new Set(tools);
  return report.cases.filter((result) => result.tools.some((tool) => wanted.has(tool)));
}

export function evalOptions(report: EvalReport): { tools: string[]; checkTypes: CheckType[] } {
  return {
    tools: [...new Set(report.cases.flatMap((result) => result.tools))].sort(),
    checkTypes: CHECK_TYPES.filter((type) =>
      report.cases.some((result) => result.checks.some((check) => check.type === type)),
    ),
  };
}

interface GridCell {
  row: string;
  column: string;
  state: 'pass' | 'fail' | 'skipped';
  detail: string;
}

/**
 * One cell per case and check type: `fail` if any check of that type failed, `pass` if all passed. A case with no check
 * of a type has no cell there. A skipped case is skipped in every column, because nothing was checked.
 */
export function checkGrid(cases: readonly CaseResult[], types: readonly CheckType[]) {
  const columns =
    types.length > 0
      ? CHECK_TYPES.filter((type) => types.includes(type))
      : CHECK_TYPES.filter((type) =>
          cases.some((result) => result.checks.some((check) => check.type === type)),
        );
  const cells: GridCell[] = [];

  for (const result of cases) {
    for (const column of columns) {
      if (result.status === 'skipped') {
        cells.push({ row: result.id, column, state: 'skipped', detail: result.note ?? 'Skipped.' });
        continue;
      }
      const checks = result.checks.filter((check) => check.type === column);
      if (checks.length === 0) continue;
      const failed = checks.filter((check) => !check.passed);
      cells.push({
        row: result.id,
        column,
        state: failed.length === 0 ? 'pass' : 'fail',
        detail:
          failed.length === 0
            ? `${checks.length} of ${checks.length} checks passed.`
            : `${checks.length - failed.length} of ${checks.length} checks passed. Failed: ${failed.map((check) => (check.detail ? `${check.name} (${check.detail})` : check.name)).join('; ')}.`,
      });
    }
  }
  return { columns, cells };
}

export interface EvalSummary {
  cases: number;
  skipped: number;
  checks: number;
  passedChecks: number;
  tokens: number;
  costUsd: number;
}

export function summarizeEvals(
  cases: readonly CaseResult[],
  types: readonly CheckType[],
): EvalSummary {
  const ran = cases.filter((result) => result.status !== 'skipped');
  const checks = ran.flatMap((result) =>
    result.checks.filter((check) => types.length === 0 || types.includes(check.type)),
  );
  return {
    cases: ran.length,
    skipped: cases.length - ran.length,
    checks: checks.length,
    passedChecks: checks.filter((check) => check.passed).length,
    tokens: ran.reduce((total, result) => total + result.tokens, 0),
    costUsd: ran.reduce((total, result) => total + result.costUsd, 0),
  };
}

/** Which report to show: the one in the link when it exists, else the first (the fixture). */
export function chooseReport<T extends { id: string }>(
  reports: readonly T[],
  filters: Pick<EvalFilters, 'report'>,
): T | null {
  return reports.find((entry) => entry.id === filters.report) ?? reports[0] ?? null;
}
