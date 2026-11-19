const NUMBER = new Intl.NumberFormat("en");
const PERCENT = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });

/** A count with thousands separators. */
export function formatNumber(value: number): string {
    return NUMBER.format(value);
}

export function formatPercent(share: number): string {
    return PERCENT.format(share);
}

/** Milliseconds as "420 ms" or "1.2 s". */
export function formatDuration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
