export interface ReportRow {
    id: string;
    status: "pass" | "fail" | "skipped";
    tools: string;
    checks: string;
    chars: number;
    tokens: number;
    costUsd: number;
    note?: string;
}

function pad(text: string, width: number): string {
    return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** A plain text table, so the same report reads in a terminal and in a CI log. */
export function formatReport(title: string, rows: ReportRow[]): string {
    const header = ["case", "result", "tools", "checks", "chars", "tokens", "est. cost"];
    const body = rows.map((row) => [
        row.id,
        row.status,
        row.tools || "none",
        row.checks,
        row.status === "skipped" ? "-" : String(row.chars),
        row.status === "skipped" ? "-" : String(row.tokens),
        row.status === "skipped" ? "-" : `$${row.costUsd.toFixed(4)}`,
    ]);
    const widths = header.map((cell, column) => Math.max(cell.length, ...body.map((line) => line[column]?.length ?? 0)));
    const line = (cells: string[]) => cells.map((cell, column) => pad(cell, widths[column] ?? 0)).join("  ");
    const passed = rows.filter((row) => row.status === "pass").length;
    const failed = rows.filter((row) => row.status === "fail").length;
    const skipped = rows.filter((row) => row.status === "skipped").length;
    const total = rows.reduce((sum, row) => sum + row.costUsd, 0);
    const notes = rows.filter((row) => row.note).map((row) => `  ${row.id}: ${row.note}`);
    return [
        "",
        title,
        line(header),
        line(widths.map((width) => "-".repeat(width))),
        ...body.map(line),
        "",
        `${passed} passed, ${failed} failed, ${skipped} skipped. Estimated cost $${total.toFixed(4)}.`,
        ...(notes.length ? ["", "Failures and skips:", ...notes] : []),
        "",
    ].join("\n");
}
