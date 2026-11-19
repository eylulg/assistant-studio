/** Text link with a visible focus ring, used for every inline link in the app. */
export const LINK_CLASS =
  'inline-flex w-max items-center gap-1 rounded-sm text-sm font-medium text-brand underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The column every message sits in, so user and assistant turns line up. */
export const MESSAGE_COLUMN_CLASS = 'mx-auto flex w-full max-w-3xl flex-col gap-6';

/** Panel surfaces: the side panels and the tool cards share one border and radius. */
export const PANEL_CLASS = 'rounded-xl border border-subtle bg-primary';

/** Muted single line under a message: usage, versions, status. */
export const META_CLASS = 'text-xs text-tertiary';

/** Visually hidden but read by screen readers. */
export const SR_ONLY_CLASS = 'sr-only';

/** The numbered chip that opens a cited source. 24 px square at least, so it meets the minimum target size. */
export const CHIP_CLASS =
  'mx-0.5 inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md border border-default bg-secondary px-1.5 align-baseline text-xs font-semibold text-brand hover:bg-brand-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The cited range in the source viewer. The underline keeps it visible without relying on colour. */
export const HIGHLIGHT_CLASS =
  'rounded-sm bg-warning-subtle text-primary underline decoration-2 underline-offset-2';

/** The insights grid: one column from 320 px, two from the large breakpoint. `min-w-0` on the cells lets charts shrink instead of overflowing. */
export const WIDGET_GRID_CLASS = 'grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0';

/** A widget that needs the full row, such as the summary tiles or a wide grid. */
export const WIDGET_WIDE_CLASS = 'lg:col-span-2';

/** Native fieldset with the legend as a small label, used for the filter groups. */
export const FIELDSET_CLASS = 'm-0 flex min-w-0 flex-col gap-2 border-0 p-0';
export const LEGEND_CLASS = 'mb-1 p-0 text-sm font-medium text-secondary';

/** The summary tiles: one column at 320 px, two from 480 px, five on the large breakpoint. */
export const KPI_GRID_CLASS =
  'grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:col-span-2 lg:grid-cols-5';

/** A bordered block of controls above the widgets. */
export const CONTROLS_PANEL_CLASS =
  'flex flex-col gap-3 rounded-xl border border-subtle bg-primary p-4';
