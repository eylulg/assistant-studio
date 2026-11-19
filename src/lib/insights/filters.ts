import { z } from 'zod';
import { answerModeSchema } from '@/lib/chat/types';
import { CHECK_TYPES, type CheckType } from './eval-report';

export const WIDGET_IDS = [
  'kpis',
  'answers',
  'tokens',
  'cache',
  'cost',
  'tools',
  'latency',
  'eval-grid',
  'eval-tokens',
  'eval-cost',
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_META: Record<WidgetId, { section: 'usage' | 'evals'; title: string }> = {
  kpis: { section: 'usage', title: 'Summary' },
  answers: { section: 'usage', title: 'Answers over time' },
  tokens: { section: 'usage', title: 'Tokens by model' },
  cache: { section: 'usage', title: 'Cache-read share' },
  cost: { section: 'usage', title: 'Estimated cost per conversation' },
  tools: { section: 'usage', title: 'Tool calls by tool' },
  latency: { section: 'usage', title: 'Latency' },
  'eval-grid': { section: 'evals', title: 'Checks by case' },
  'eval-tokens': { section: 'evals', title: 'Tokens per case' },
  'eval-cost': { section: 'evals', title: 'Estimated cost per case' },
};

export const MODES = [...answerModeSchema.options, 'unknown'] as const;

export interface UsageFilters {
  /** First day to include, `YYYY-MM-DD`. */
  from: string | null;
  /** Last day to include, `YYYY-MM-DD`. */
  to: string | null;
  models: string[];
  tools: string[];
  conversations: string[];
  modes: (typeof MODES)[number][];
}

export interface EvalFilters {
  tools: string[];
  checkTypes: CheckType[];
  /** The id of the report to show. `null` is the default report. */
  report: string | null;
}

/** Everything a saved view or a link holds: the filters and which widgets are on screen. */
export interface ViewState {
  usage: UsageFilters;
  evals: EvalFilters;
  hidden: WidgetId[];
}

export const EMPTY_VIEW: ViewState = {
  usage: { from: null, to: null, models: [], tools: [], conversations: [], modes: [] },
  evals: { tools: [], checkTypes: [], report: null },
  hidden: [],
};

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, so `2026-02-31` is refused rather than silently moved to March. */
function parseDay(value: string | null): string | null {
  if (!value || !dayPattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return uniqueSorted(
    values.filter((value): value is T => (allowed as readonly string[]).includes(value)),
  );
}

/**
 * Reads a view from the query string. Anything it does not understand is dropped, so a hand-edited or outdated link
 * shows the default view instead of an error.
 */
export function parseView(params: URLSearchParams): ViewState {
  // A range that is backwards is kept as typed: the filter shows nothing and the page says why, so a date being typed is never rewritten.
  const from = parseDay(params.get('from'));
  const to = parseDay(params.get('to'));
  const report = params.get('report');

  return {
    usage: {
      from,
      to,
      models: uniqueSorted(params.getAll('model').filter(Boolean)),
      tools: uniqueSorted(params.getAll('tool').filter(Boolean)),
      conversations: uniqueSorted(params.getAll('conversation').filter(Boolean)),
      modes: pick(params.getAll('mode'), MODES),
    },
    evals: {
      tools: uniqueSorted(params.getAll('eval-tool').filter(Boolean)),
      checkTypes: pick(params.getAll('check'), CHECK_TYPES),
      report: report ? report : null,
    },
    hidden: pick(params.getAll('hide'), WIDGET_IDS),
  };
}

/** The shortest query string that holds the view. Defaults are left out, lists are sorted, so equal views give equal links. */
export function serializeView(view: ViewState): URLSearchParams {
  const params = new URLSearchParams();
  if (view.usage.from) params.set('from', view.usage.from);
  if (view.usage.to) params.set('to', view.usage.to);
  for (const value of view.usage.models) params.append('model', value);
  for (const value of view.usage.tools) params.append('tool', value);
  for (const value of view.usage.conversations) params.append('conversation', value);
  for (const value of view.usage.modes) params.append('mode', value);
  for (const value of view.evals.tools) params.append('eval-tool', value);
  for (const value of view.evals.checkTypes) params.append('check', value);
  if (view.evals.report) params.set('report', view.evals.report);
  for (const value of view.hidden) params.append('hide', value);
  return params;
}

/** A list of ids from storage, keeping the ones this version knows. A view saved before a widget was renamed still opens. */
function known<T extends string>(allowed: readonly T[]) {
  return z.array(z.string()).transform((values) => pick(values, allowed));
}

/** The shape saved views are stored in. It is the same view, checked with zod on the way out of storage. */
export const viewStateSchema = z.object({
  usage: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    models: z.array(z.string()),
    tools: z.array(z.string()),
    conversations: z.array(z.string()),
    modes: known(MODES),
  }),
  evals: z.object({
    tools: z.array(z.string()),
    checkTypes: known(CHECK_TYPES),
    report: z.string().nullable(),
  }),
  hidden: known(WIDGET_IDS),
});
