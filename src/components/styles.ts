/** Text link with a visible focus ring, used for every inline link in the app. */
export const LINK_CLASS =
    "inline-flex w-max items-center gap-1 rounded-sm text-sm font-medium text-brand underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** The column every message sits in, so user and assistant turns line up. */
export const MESSAGE_COLUMN_CLASS = "mx-auto flex w-full max-w-3xl flex-col gap-6";

/** Panel surfaces: the side panels and the tool cards share one border and radius. */
export const PANEL_CLASS = "rounded-xl border border-subtle bg-primary";

/** Muted single line under a message: usage, versions, status. */
export const META_CLASS = "text-xs text-tertiary";

/** Visually hidden but read by screen readers. */
export const SR_ONLY_CLASS = "sr-only";
