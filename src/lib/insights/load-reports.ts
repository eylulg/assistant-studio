import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type EvalReport, evalReportSchema } from './eval-report';

export interface NamedReport {
  /** The file name without `.json`, which is also the value in the URL. */
  id: string;
  report: EvalReport;
}

const REPORTS_DIR = join(process.cwd(), 'evals', 'reports');

/**
 * Reads every report the eval suite has written. Runs on the server while the page is built, so the reports ship as
 * page data and the browser never fetches them. A file that does not match the schema fails the build, because a
 * chart of a half-read report would be worse than none. The fixture comes first, live runs follow, newest first.
 */
export function loadReports(): NamedReport[] {
  const files = readdirSync(REPORTS_DIR).filter((file) => file.endsWith('.json'));
  const reports = files.map((file) => {
    const parsed = evalReportSchema.safeParse(
      JSON.parse(readFileSync(join(REPORTS_DIR, file), 'utf8')),
    );
    if (!parsed.success)
      throw new Error(`evals/reports/${file} is not a valid eval report: ${parsed.error.message}`);
    return { id: file.replace(/\.json$/, ''), report: parsed.data };
  });
  const rank = (entry: NamedReport) => (entry.report.kind === 'fixture' ? 0 : 1);
  return reports.sort((a, b) => rank(a) - rank(b) || b.id.localeCompare(a.id));
}
