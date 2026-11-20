'use client';

import { Button } from '@eylulg/ui/button';
import { EmptyState } from '@eylulg/ui/empty-state';
import { Input } from '@eylulg/ui/input';
import { BarChart3, FilterX } from 'lucide-react';
import { FIELDSET_CLASS, LEGEND_CLASS, META_CLASS, WIDGET_GRID_CLASS } from '@/components/styles';
import {
  type UsageFilters,
  type ViewState,
  WIDGET_IDS,
  WIDGET_META,
  type WidgetId,
} from '@/lib/insights/filters';
import type { AnswerRecord } from '@/lib/insights/records';
import {
  MODE_LABEL,
  filterAnswers,
  filterOptions,
  rangeIsBackwards,
} from '@/lib/insights/usage-select';
import { modelLabel } from '@/lib/models';
import { CheckboxFilter } from './checkbox-filter';
import { FilterPanel } from './filter-panel';
import {
  AnswersWidget,
  CacheWidget,
  CostWidget,
  KpiWidget,
  LatencyWidget,
  TokensWidget,
  ToolsWidget,
} from './usage-widgets';
import { WidgetToggles } from './widget-toggles';

interface UsageSectionProps {
  records: readonly AnswerRecord[];
  view: ViewState;
  onChange: (view: ViewState) => void;
}

const USAGE_WIDGETS = WIDGET_IDS.filter((id) => WIDGET_META[id].section === 'usage');

function activeFilters(filters: UsageFilters): number {
  return [
    filters.from,
    filters.to,
    filters.models.length,
    filters.tools.length,
    filters.conversations.length,
    filters.modes.length,
  ].filter(Boolean).length;
}

export function UsageSection({ records, view, onChange }: UsageSectionProps) {
  const { usage } = view;
  const options = filterOptions(records);
  const filtered = filterAnswers(records, usage);
  const backwards = rangeIsBackwards(usage);
  const shown = (id: WidgetId) => !view.hidden.includes(id);

  function update(patch: Partial<UsageFilters>) {
    onChange({ ...view, usage: { ...usage, ...patch } });
  }

  function handleFrom(from: string) {
    update({ from: from || null });
  }

  function handleTo(to: string) {
    update({ to: to || null });
  }

  function handleModels(models: string[]) {
    update({ models });
  }

  function handleModes(modes: UsageFilters['modes']) {
    update({ modes });
  }

  function handleTools(tools: string[]) {
    update({ tools });
  }

  function handleConversations(conversations: string[]) {
    update({ conversations });
  }

  function handleReset() {
    update({ from: null, to: null, models: [], tools: [], conversations: [], modes: [] });
  }

  return (
    <div className='flex flex-col gap-4'>
      <FilterPanel
        activeCount={activeFilters(usage)}
        resetLabel='Reset usage filters'
        onReset={handleReset}
      >
        <fieldset className={FIELDSET_CLASS}>
          <legend className={LEGEND_CLASS}>Date range</legend>
          <Input type='date' label='From date' value={usage.from ?? ''} onChange={handleFrom} />
          <Input
            type='date'
            label='To date'
            value={usage.to ?? ''}
            onChange={handleTo}
            errorMessage={backwards ? 'The start date is after the end date.' : undefined}
          />
        </fieldset>
        <CheckboxFilter
          legend='Model'
          options={options.models.map((value) => ({ value, label: modelLabel(value) }))}
          selected={usage.models}
          onChange={handleModels}
        />
        <CheckboxFilter
          legend='Answer mode'
          options={options.modes.map((value) => ({ value, label: MODE_LABEL[value] }))}
          selected={usage.modes}
          onChange={handleModes}
        />
        <CheckboxFilter
          legend='Tool'
          options={options.tools.map((value) => ({ value, label: value }))}
          selected={usage.tools}
          onChange={handleTools}
          emptyText='No tool has run yet'
        />
        <CheckboxFilter
          legend='Conversation'
          options={options.conversations.map((entry) => ({ value: entry.id, label: entry.title }))}
          selected={usage.conversations}
          onChange={handleConversations}
        />
        <WidgetToggles legend='Usage widgets' ids={USAGE_WIDGETS} view={view} onChange={onChange} />
      </FilterPanel>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FilterX}
          size='sm'
          headingLevel={3}
          title='No answers match these filters'
          description={`${records.length} saved answers are outside the date range, model, mode, tool or conversation you chose.${backwards ? ' The start date is after the end date.' : ''}`}
          primaryAction={
            <Button variant='secondary' size='sm' onPress={handleReset}>
              Clear usage filters
            </Button>
          }
        />
      ) : (
        <>
          <p className={META_CLASS}>
            {`${filtered.length} of ${records.length} answers. Cost, cache share and latency cover model answers only. Demo replay and extractive answers are counted apart.`}
          </p>
          <div className={WIDGET_GRID_CLASS}>
            {shown('kpis') ? <KpiWidget records={filtered} /> : null}
            {shown('answers') ? <AnswersWidget records={filtered} /> : null}
            {shown('tokens') ? <TokensWidget records={filtered} /> : null}
            {shown('cache') ? <CacheWidget records={filtered} /> : null}
            {shown('cost') ? <CostWidget records={filtered} /> : null}
            {shown('tools') ? <ToolsWidget records={filtered} onlyTools={usage.tools} /> : null}
            {shown('latency') ? <LatencyWidget records={filtered} /> : null}
          </div>
        </>
      )}
    </div>
  );
}

/** What the page shows before there is anything to chart. */
export function NoConversations() {
  return (
    <EmptyState
      icon={BarChart3}
      size='md'
      headingLevel={3}
      title='No conversations yet'
      description='Ask something in the studio and your usage shows up here.'
      primaryAction={
        <Button href='/' variant='primary'>
          Open the studio
        </Button>
      }
    />
  );
}
