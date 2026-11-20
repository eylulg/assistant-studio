'use client';

import { BarChart, HeatGrid } from '@eylulg/ui/chart';
import { WIDGET_WIDE_CLASS } from '@/components/styles';
import type { CaseResult, CheckType } from '@/lib/insights/eval-report';
import { CHECK_TYPE_LABEL, checkGrid } from '@/lib/insights/eval-select';
import { WidgetCard, tableLabels } from './widget-card';

interface EvalWidgetProps {
  cases: readonly CaseResult[];
  /** Said under the chart when the numbers are not a live measurement. */
  sampleNote: string | null;
}

/** The charts show only cases that called a model. The others, answered in the browser, have no usage to chart. */
function modelCases(cases: readonly CaseResult[]) {
  const ran = cases.filter((result) => result.status !== 'skipped');
  const withUsage = ran.filter((result) => result.tokens > 0);
  const left = ran.length - withUsage.length;
  return {
    withUsage,
    leftOutNote: left > 0 ? `${left} cases made no model call and are left out.` : null,
  };
}

const STATES = {
  pass: { label: 'Pass', tone: 'success' },
  fail: { label: 'Fail', tone: 'error' },
  skipped: { label: 'Skipped', tone: 'neutral' },
} as const;

export function EvalGridWidget({
  cases,
  types,
}: {
  cases: readonly CaseResult[];
  types: readonly CheckType[];
}) {
  const { columns, cells } = checkGrid(cases, types);

  return (
    <WidgetCard
      title='Checks by case'
      description='One cell per case and check type. A cell fails if any check of that type failed.'
      className={WIDGET_WIDE_CLASS}
      note='Blank means the case has no check of that type.'
    >
      <HeatGrid
        title='Checks by case'
        labels={tableLabels('Checks by case')}
        hideTitle
        rowLabel='Case'
        rows={cases.map((result) => ({ id: result.id, label: result.label }))}
        columns={columns.map((type) => ({ id: type, label: CHECK_TYPE_LABEL[type] }))}
        states={STATES}
        cells={cells}
      />
    </WidgetCard>
  );
}

export function EvalTokensWidget({ cases, sampleNote }: EvalWidgetProps) {
  const { withUsage: ran, leftOutNote } = modelCases(cases);

  return (
    <WidgetCard
      title='Tokens per case'
      description='Input, cache and output tokens per answer.'
      note={[sampleNote, leftOutNote].filter(Boolean).join(' ')}
    >
      <BarChart
        title='Tokens per case'
        labels={tableLabels('Tokens per case')}
        hideTitle
        locale='en'
        orientation='horizontal'
        categoryLabel='Case'
        valueFormat={{ maximumFractionDigits: 0 }}
        categories={ran.map((result) => result.label)}
        series={[
          {
            id: 'tokens',
            label: 'Tokens',
            values: ran.map((result) => result.tokens),
            colorIndex: 3,
          },
        ]}
      />
    </WidgetCard>
  );
}

export function EvalCostWidget({ cases, sampleNote }: EvalWidgetProps) {
  const { withUsage: ran, leftOutNote } = modelCases(cases);

  return (
    <WidgetCard
      title='Estimated cost per case'
      description='Estimated from list prices.'
      note={[sampleNote, leftOutNote].filter(Boolean).join(' ')}
    >
      <BarChart
        title='Estimated cost per case'
        labels={tableLabels('Estimated cost per case')}
        hideTitle
        locale='en'
        orientation='horizontal'
        categoryLabel='Case'
        valueFormat={{ style: 'currency', currency: 'USD', maximumFractionDigits: 4 }}
        categories={ran.map((result) => result.label)}
        series={[
          {
            id: 'cost',
            label: 'Estimated cost',
            values: ran.map((result) => result.costUsd),
            colorIndex: 3,
          },
        ]}
      />
    </WidgetCard>
  );
}
