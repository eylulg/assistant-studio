'use client';

import { BarChart, LineChart } from '@eylulg/ui/chart';
import { Stat } from '@eylulg/ui/stat';
import { KPI_GRID_CLASS, META_CLASS, WIDGET_WIDE_CLASS } from '@/components/styles';
import { formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { MODES } from '@/lib/insights/filters';
import type { AnswerRecord, RecordMode } from '@/lib/insights/records';
import {
  MODE_COLOR,
  MODE_LABEL,
  answersByDay,
  cacheShareByDay,
  costByConversation,
  latencyHistogram,
  summarize,
  tokensByModel,
  toolCallCounts,
} from '@/lib/insights/usage-select';
import { formatCost } from '@/lib/models';
import { WidgetCard, tableLabels } from './widget-card';

interface WidgetProps {
  records: readonly AnswerRecord[];
}

const DAY_FORMAT = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const USD_FORMAT: Intl.NumberFormatOptions = {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 4,
};

/**
 * The days are named, not given as dates: the chart adds a time of day to every date when the data covers less than two days,
 * and a day has no time. A day the data skips is still in the list, so the spacing stays right.
 */
function dayLabel(day: string): string {
  return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** "3 demo replay, 1 extractive" for the modes that occur, without the ones in `skip`. */
function modeBreakdown(
  counts: Partial<Record<RecordMode, number>>,
  skip: readonly RecordMode[] = [],
): string {
  return MODES.flatMap((mode) => {
    const count = counts[mode];
    return count && !skip.includes(mode)
      ? [`${formatNumber(count)} ${MODE_LABEL[mode].toLowerCase()}`]
      : [];
  }).join(', ');
}

export function KpiWidget({ records }: WidgetProps) {
  const summary = summarize(records);
  const { model } = summary;
  const others = modeBreakdown(summary.byMode, ['model']);
  const none = 'No model answers yet';
  // Cost, cache and latency describe a model, so demo replay and extractive answers are left out of them and named here.
  const scope =
    model.answers === 0
      ? 'Demo replay and extractive answers are not counted'
      : others
        ? `Left out: ${others}`
        : `Over ${plural(model.answers, 'model answer', 'model answers')}`;

  return (
    <div className={KPI_GRID_CLASS}>
      <Stat
        isCard
        label='Answers'
        value={formatNumber(summary.answers)}
        detail={modeBreakdown(summary.byMode) || 'None yet'}
      />
      <Stat
        isCard
        label='Model cost, estimated'
        value={model.answers === 0 ? none : formatCost(model.costUsd)}
        detail={`From list prices. ${scope}`}
      />
      <Stat
        isCard
        label='Model cache-read share'
        value={
          model.answers === 0
            ? none
            : model.cacheShare === null
              ? 'No input'
              : formatPercent(model.cacheShare)
        }
        detail={`Of input tokens. ${scope}`}
      />
      <Stat
        isCard
        label='Model time to first token'
        value={
          model.answers === 0
            ? none
            : model.medianFirstTokenMs === null
              ? 'Not recorded'
              : formatDuration(model.medianFirstTokenMs)
        }
        detail={
          model.answers === 0
            ? scope
            : model.timed === 0
              ? 'Older answers have no timing'
              : `Median over ${plural(model.timed, 'timed model answer', 'timed model answers')}`
        }
      />
      <Stat
        isCard
        label='Tool calls'
        value={formatNumber(summary.toolCalls)}
        detail='Calls that ran, in every mode'
      />
    </div>
  );
}

export function AnswersWidget({ records }: WidgetProps) {
  const { days, series } = answersByDay(records);

  return (
    <WidgetCard
      title='Answers over time'
      description='Answers per day, by where the answer came from.'
      className={WIDGET_WIDE_CLASS}
      note='Days follow your time zone. A day with no answer is shown as zero.'
    >
      <LineChart
        title='Answers over time'
        labels={tableLabels('Answers over time')}
        hideTitle
        locale='en'
        x={days.map(dayLabel)}
        xLabel='Day'
        valueFormat={{ maximumFractionDigits: 0 }}
        series={series.map((entry) => ({
          id: entry.mode,
          label: MODE_LABEL[entry.mode],
          values: entry.values,
          colorIndex: MODE_COLOR[entry.mode],
        }))}
      />
    </WidgetCard>
  );
}

export function TokensWidget({ records }: WidgetProps) {
  const groups = tokensByModel(records);

  return (
    <WidgetCard
      title='Tokens by model'
      description='Uncached input, output, cache reads and cache writes.'
      note='Replays are grouped apart from the model they imitate. Their token counts are samples from the demo transcripts. Answers that failed or wait for an approval are included, because they were billed.'
    >
      <BarChart
        title='Tokens by model'
        labels={tableLabels('Tokens by model')}
        hideTitle
        locale='en'
        categoryLabel='Model'
        categories={groups.map((group) => group.label)}
        series={[
          {
            id: 'input',
            label: 'Input',
            values: groups.map((group) => group.input),
            colorIndex: 0,
          },
          {
            id: 'output',
            label: 'Output',
            values: groups.map((group) => group.output),
            colorIndex: 1,
          },
          {
            id: 'cache-read',
            label: 'Cache read',
            values: groups.map((group) => group.cacheRead),
            colorIndex: 2,
          },
          {
            id: 'cache-write',
            label: 'Cache write',
            values: groups.map((group) => group.cacheWrite),
            colorIndex: 3,
          },
        ]}
      />
    </WidgetCard>
  );
}

export function CacheWidget({ records }: WidgetProps) {
  const { days, series } = cacheShareByDay(records);

  return (
    <WidgetCard
      title='Cache-read share'
      description='The part of the input served from the cache, per day.'
      note='A day with no input tokens is left blank, not shown as zero.'
    >
      <LineChart
        title='Cache-read share'
        labels={tableLabels('Cache-read share')}
        hideTitle
        locale='en'
        x={days.map(dayLabel)}
        xLabel='Day'
        valueFormat={{ style: 'percent', maximumFractionDigits: 0 }}
        yDomain={[0, 1]}
        series={series.map((entry) => ({
          id: entry.mode,
          label: MODE_LABEL[entry.mode],
          values: entry.values,
          colorIndex: MODE_COLOR[entry.mode],
        }))}
      />
    </WidgetCard>
  );
}

export function CostWidget({ records }: WidgetProps) {
  const { categories, series } = costByConversation(records);

  return (
    <WidgetCard
      title='Estimated cost per conversation'
      description='The twelve most expensive conversations, by mode.'
      note='An estimate from list prices. Demo replay cost comes from sample usage in the demo transcripts.'
    >
      <BarChart
        title='Estimated cost per conversation'
        labels={tableLabels('Estimated cost per conversation')}
        hideTitle
        locale='en'
        orientation='horizontal'
        grouping='stacked'
        categoryLabel='Conversation'
        valueFormat={USD_FORMAT}
        categories={categories}
        series={series.map((entry) => ({
          id: entry.mode,
          label: MODE_LABEL[entry.mode],
          values: entry.values,
          colorIndex: MODE_COLOR[entry.mode],
        }))}
      />
    </WidgetCard>
  );
}

export function ToolsWidget({
  records,
  onlyTools,
}: WidgetProps & { onlyTools: readonly string[] }) {
  const counts = toolCallCounts(records, onlyTools);

  return (
    <WidgetCard
      title='Tool calls by tool'
      description='Calls that ran. Denied and cancelled calls are not counted.'
    >
      <BarChart
        title='Tool calls by tool'
        labels={tableLabels('Tool calls by tool')}
        hideTitle
        locale='en'
        orientation='horizontal'
        categoryLabel='Tool'
        valueFormat={{ maximumFractionDigits: 0 }}
        categories={counts.map((entry) => entry.name)}
        series={[
          {
            id: 'calls',
            label: 'Calls',
            values: counts.map((entry) => entry.count),
            colorIndex: 0,
          },
        ]}
      />
    </WidgetCard>
  );
}

export function LatencyWidget({ records }: WidgetProps) {
  const histogram = latencyHistogram(records);
  const notes = [
    'Answers a model produced.',
    histogram.untimed > 0
      ? `${plural(histogram.untimed, 'model answer has', 'model answers have')} no timing recorded and ${histogram.untimed === 1 ? 'is' : 'are'} left out.`
      : null,
    Object.keys(histogram.leftOut).length > 0
      ? `Left out, because no model was timed: ${modeBreakdown(histogram.leftOut)}. Their timing is the pace of the demo or of the browser.`
      : null,
  ].filter(Boolean);

  return (
    <WidgetCard
      title='Latency'
      description='How many model answers fell in each time bin: first token and total.'
      note={notes.join(' ')}
    >
      <BarChart
        title='Latency distribution'
        labels={tableLabels('Latency distribution')}
        hideTitle
        locale='en'
        categoryLabel='Time'
        valueFormat={{ maximumFractionDigits: 0 }}
        categories={histogram.bins}
        series={[
          {
            id: 'first-token',
            label: 'Time to first token',
            values: histogram.firstToken,
            colorIndex: 0,
          },
          { id: 'total', label: 'Total time', values: histogram.total, colorIndex: 1 },
        ]}
      />
      {histogram.timed === 0 ? (
        <p className={META_CLASS}>There are no timed model answers to show.</p>
      ) : null}
    </WidgetCard>
  );
}
