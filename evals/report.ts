import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CaseResult, EvalReport } from '@/lib/insights/eval-report';
import type { Check } from './checks';

export interface ReportRow {
  id: string;
  label: string;
  prompt: string;
  status: 'pass' | 'fail' | 'skipped';
  tools: string;
  checks: string;
  results: Check[];
  chars: number;
  tokens: number;
  costUsd: number;
  note?: string;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** A plain text table, so the same report reads in a terminal and in a CI log. */
export function formatReport(title: string, rows: ReportRow[]): string {
  const header = ['case', 'result', 'tools', 'checks', 'chars', 'tokens', 'est. cost'];
  const body = rows.map((row) => [
    row.id,
    row.status,
    row.tools || 'none',
    row.checks,
    row.status === 'skipped' ? '-' : String(row.chars),
    row.status === 'skipped' ? '-' : String(row.tokens),
    row.status === 'skipped' ? '-' : `$${row.costUsd.toFixed(4)}`,
  ]);
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...body.map((line) => line[column]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join('  ');
  const passed = rows.filter((row) => row.status === 'pass').length;
  const failed = rows.filter((row) => row.status === 'fail').length;
  const skipped = rows.filter((row) => row.status === 'skipped').length;
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const notes = rows.filter((row) => row.note).map((row) => `  ${row.id}: ${row.note}`);
  return [
    '',
    title,
    line(header),
    line(widths.map((width) => '-'.repeat(width))),
    ...body.map(line),
    '',
    `${passed} passed, ${failed} failed, ${skipped} skipped. Estimated cost $${total.toFixed(4)}.`,
    ...(notes.length ? ['', 'Failures and skips:', ...notes] : []),
    '',
  ].join('\n');
}

const REPORTS_DIR = fileURLToPath(new URL('./reports/', import.meta.url));

/**
 * Writes the run as JSON next to the table: `fixture.json` for a replay, `live-<timestamp>.json` for a real run.
 * Returns the path. The colons of a live timestamp become dashes, so the name is safe on every file system.
 */
export function writeReport(
  rows: ReportRow[],
  run: { kind: 'fixture' } | { kind: 'live'; at: Date },
  model: string,
): string {
  const cases: CaseResult[] = rows.map((row) => ({
    id: row.id,
    label: row.label,
    prompt: row.prompt,
    status: row.status,
    tools: row.tools ? row.tools.split(', ') : [],
    checks: row.results,
    chars: row.chars,
    tokens: row.tokens,
    costUsd: row.costUsd,
    ...(row.note ? { note: row.note } : {}),
  }));
  const report: EvalReport =
    run.kind === 'fixture'
      ? { version: 1, kind: 'fixture', model, cases }
      : { version: 1, kind: 'live', model, generatedAt: run.at.toISOString(), cases };
  const stamp =
    run.kind === 'live'
      ? run.at
          .toISOString()
          .replace(/\.\d+Z$/, 'Z')
          .replace(/:/g, '-')
      : '';
  mkdirSync(REPORTS_DIR, { recursive: true });
  const path = `${REPORTS_DIR}${run.kind === 'fixture' ? 'fixture' : `live-${stamp}`}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}
