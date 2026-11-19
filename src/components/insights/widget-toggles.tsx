'use client';

import { type ViewState, WIDGET_META, type WidgetId } from '@/lib/insights/filters';
import { CheckboxFilter } from './checkbox-filter';

interface WidgetTogglesProps {
  legend: string;
  /** The widgets of one section. Hidden widgets of the other section are left as they are. */
  ids: readonly WidgetId[];
  view: ViewState;
  onChange: (view: ViewState) => void;
}

/** Which widgets are on screen. A hidden widget is not rendered, so it does no work. */
export function WidgetToggles({ legend, ids, view, onChange }: WidgetTogglesProps) {
  const shown = ids.filter((id) => !view.hidden.includes(id));

  function handleChange(next: WidgetId[]) {
    const others = view.hidden.filter((id) => !ids.includes(id));
    onChange({ ...view, hidden: [...others, ...ids.filter((id) => !next.includes(id))].sort() });
  }

  return (
    <CheckboxFilter
      legend={legend}
      options={ids.map((id) => ({ value: id, label: WIDGET_META[id].title }))}
      selected={shown}
      onChange={handleChange}
    />
  );
}
