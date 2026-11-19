import { describe, expect, it } from 'vitest';
import type { CaseResult, EvalReport } from '../eval-report';
import { checkGrid, chooseReport, evalOptions, filterCases, summarizeEvals } from '../eval-select';

function result(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
    prompt: id,
    status: 'pass',
    tools: [],
    checks: [],
    chars: 0,
    tokens: 100,
    costUsd: 0.01,
    ...overrides,
  };
}

const report: EvalReport = {
  version: 1,
  kind: 'fixture',
  model: 'm',
  cases: [
    result('calc', {
      tools: ['calculate'],
      checks: [
        { type: 'tools', name: 'tool: calculate', passed: true, detail: '' },
        { type: 'answer', name: 'contains "516"', passed: true, detail: '' },
      ],
    }),
    result('notes', {
      status: 'fail',
      tools: ['search_notes'],
      checks: [
        { type: 'tools', name: 'tool: search_notes', passed: true, detail: '' },
        {
          type: 'answer',
          name: 'cites note-06',
          passed: false,
          detail: 'no citation in the answer',
        },
        { type: 'answer', name: 'at most 40 characters', passed: true, detail: '' },
      ],
    }),
    result('late', { status: 'skipped', note: 'budget reached', tokens: 0, costUsd: 0 }),
  ],
};

describe("the eval charts' data", () => {
  it('marks a type failed when any check of it failed, says which, and skips what never ran', () => {
    const { columns, cells } = checkGrid(report.cases, []);

    expect(columns).toEqual(['tools', 'answer']);
    expect(cells.find((cell) => cell.row === 'calc' && cell.column === 'answer')).toMatchObject({
      state: 'pass',
    });
    expect(cells.find((cell) => cell.row === 'notes' && cell.column === 'answer')).toMatchObject({
      state: 'fail',
      detail: '1 of 2 checks passed. Failed: cites note-06 (no citation in the answer).',
    });
    expect(cells.filter((cell) => cell.row === 'late').map((cell) => cell.state)).toEqual([
      'skipped',
      'skipped',
    ]);
  });

  it('narrows to the chosen tools and check types', () => {
    const cases = filterCases(report, ['search_notes']);

    expect(cases.map((entry) => entry.id)).toEqual(['notes']);
    expect(checkGrid(cases, ['answer']).columns).toEqual(['answer']);
    expect(evalOptions(report)).toEqual({
      tools: ['calculate', 'search_notes'],
      checkTypes: ['tools', 'answer'],
    });
  });

  it('sums checks, tokens and cost without the skipped cases', () => {
    expect(summarizeEvals(report.cases, ['answer'])).toEqual({
      cases: 2,
      skipped: 1,
      checks: 3,
      passedChecks: 2,
      tokens: 200,
      costUsd: 0.02,
    });
  });

  it('picks the report from the link, or the first one when the link names none that exists', () => {
    const reports = [{ id: 'fixture' }, { id: 'live-1' }];

    expect(chooseReport(reports, { report: 'live-1' })).toBe(reports[1]);
    expect(chooseReport(reports, { report: 'gone' })).toBe(reports[0]);
    expect(chooseReport([], { report: null })).toBeNull();
  });
});
