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
      description='Each cell is one type of check on one case. It fails when any check of that type failed.'
      className={WIDGET_WIDE_CLASS}
      note='A blank cell means the case has no check of that type.'
    >
      <HeatGrid
        title='Checks by case'
        labels={tableLabels('Checks by case')}
        hideTitle
        rowLabel='Case'
        rows={cases.map((result) => ({ id: result.id, label: result.id }))}
        columns={columns.map((type) => ({ id: type, label: CHECK_TYPE_LABEL[type] }))}
        states={STATES}
        cells={cells}
      />
    </WidgetCard>
  );
}

export function EvalTokensWidget({ cases, sampleNote }: EvalWidgetProps) {
  const ran = cases.filter((result) => result.status !== 'skipped');

  return (
    <WidgetCard
      title='Tokens per case'
      description='Input, cache and output tokens of each answer.'
      note={sampleNote ?? undefined}
    >
      <BarChart
        title='Tokens per case'
        labels={tableLabels('Tokens per case')}
        hideTitle
        locale='en'
        orientation='horizontal'
        categoryLabel='Case'
        valueFormat={{ maximumFractionDigits: 0 }}
        categories={ran.map((result) => result.id)}
        series={[
          {
            id: 'tokens',
            label: 'Tokens',
            values: ran.map((result) => result.tokens),
            colorIndex: 0,
          },
        ]}
      />
    </WidgetCard>
  );
}

export function EvalCostWidget({ cases, sampleNote }: EvalWidgetProps) {
  const ran = cases.filter((result) => result.status !== 'skipped');

  return (
    <WidgetCard
      title='Estimated cost per case'
      description='An estimate from list prices.'
      note={sampleNote ?? undefined}
    >
      <BarChart
        title='Estimated cost per case'
        labels={tableLabels('Estimated cost per case')}
        hideTitle
        locale='en'
        orientation='horizontal'
        categoryLabel='Case'
        valueFormat={{ style: 'currency', currency: 'USD', maximumFractionDigits: 4 }}
        categories={ran.map((result) => result.id)}
        series={[
          {
            id: 'cost',
            label: 'Estimated cost',
            values: ran.map((result) => result.costUsd),
            colorIndex: 1,
          },
        ]}
      />
    </WidgetCard>
  );
}
