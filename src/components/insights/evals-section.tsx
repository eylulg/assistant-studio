"use client";

import { Button } from "@eylulg/ui/button";
import { CodeBlock } from "@eylulg/ui/code-block";
import { EmptyState } from "@eylulg/ui/empty-state";
import { Select, SelectItem } from "@eylulg/ui/select";
import { Stat } from "@eylulg/ui/stat";
import { FlaskConical, TerminalSquare } from "lucide-react";
import { META_CLASS, WIDGET_GRID_CLASS } from "@/components/styles";
import type { CheckType } from "@/lib/insights/eval-report";
import { CHECK_TYPE_LABEL, chooseReport, evalOptions, filterCases, summarizeEvals } from "@/lib/insights/eval-select";
import { type EvalFilters, type ViewState, WIDGET_IDS, WIDGET_META, type WidgetId } from "@/lib/insights/filters";
import { formatNumber } from "@/lib/insights/format";
import type { NamedReport } from "@/lib/insights/load-reports";
import { formatCost } from "@/lib/models";
import { CheckboxFilter } from "./checkbox-filter";
import { EvalCostWidget, EvalGridWidget, EvalTokensWidget } from "./eval-widgets";
import { FilterPanel } from "./filter-panel";
import { WidgetToggles } from "./widget-toggles";

interface EvalsSectionProps {
    reports: readonly NamedReport[];
    view: ViewState;
    onChange: (view: ViewState) => void;
}

const EVAL_WIDGETS = WIDGET_IDS.filter((id) => WIDGET_META[id].section === "evals");
const LIVE_COMMAND = "npm run eval:live";

function describeReport({ id, report }: NamedReport): string {
    if (report.kind === "fixture") return "Fixture, recorded transcripts";
    return `Live run, ${report.model}${report.generatedAt ? `, ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC` : ""} (${id})`;
}

function activeFilters(filters: EvalFilters): number {
    return [filters.tools.length, filters.checkTypes.length].filter(Boolean).length;
}

function LiveEmptyState() {
    return (
        <EmptyState
            icon={TerminalSquare}
            size="sm"
            headingLevel={3}
            title="No live report yet"
            description="Live runs happen on your own machine with your own API key. The public demo has no key and never calls the model. A run writes a report to evals/reports, and the next build of this page shows it here."
            primaryAction={
                <CodeBlock label="Command for a live eval run" copyable copyLabel="Copy the command" wrap>
                    {LIVE_COMMAND}
                </CodeBlock>
            }
        />
    );
}

export function EvalsSection({ reports, view, onChange }: EvalsSectionProps) {
    const chosen = chooseReport(reports, view.evals);
    const { evals } = view;
    const shown = (id: WidgetId) => !view.hidden.includes(id);
    const hasLive = reports.some((entry) => entry.report.kind === "live");

    if (!chosen) {
        return (
            <EmptyState
                icon={FlaskConical}
                size="sm"
                headingLevel={3}
                title="No eval report found"
                description="Run npm run eval to write evals/reports/fixture.json, then build again."
            />
        );
    }

    const { report } = chosen;
    const options = evalOptions(report);
    const cases = filterCases(report, evals.tools);
    const summary = summarizeEvals(cases, evals.checkTypes);
    const sampleNote =
        report.kind === "fixture"
            ? "Fixture report: tokens and cost are the usage stored in the recorded transcripts, so they are samples and not a live measurement."
            : "Measured on a live run. Cost is an estimate from list prices.";

    function update(patch: Partial<EvalFilters>) {
        onChange({ ...view, evals: { ...evals, ...patch } });
    }

    function handleReport(key: string | number | null) {
        if (key === null) return;
        update({ report: key === reports[0]?.id ? null : String(key) });
    }

    function handleTools(tools: string[]) {
        update({ tools });
    }

    function handleCheckTypes(checkTypes: CheckType[]) {
        update({ checkTypes });
    }

    function handleReset() {
        update({ tools: [], checkTypes: [] });
    }

    return (
        <div className="flex flex-col gap-4">
            <FilterPanel activeCount={activeFilters(evals)} resetLabel="Reset eval filters" onReset={handleReset}>
                <Select label="Report" items={reports} selectedKey={chosen.id} onSelectionChange={handleReport}>
                    {(entry) => (
                        <SelectItem id={entry.id} textValue={describeReport(entry)}>
                            {describeReport(entry)}
                        </SelectItem>
                    )}
                </Select>
                <CheckboxFilter
                    legend="Case uses tool"
                    options={options.tools.map((value) => ({ value, label: value }))}
                    selected={evals.tools}
                    onChange={handleTools}
                    emptyText="No case calls a tool"
                />
                <CheckboxFilter
                    legend="Check type"
                    options={options.checkTypes.map((value) => ({ value, label: CHECK_TYPE_LABEL[value] }))}
                    selected={evals.checkTypes}
                    onChange={handleCheckTypes}
                />
                <WidgetToggles legend="Eval widgets" ids={EVAL_WIDGETS} view={view} onChange={onChange} />
            </FilterPanel>

            {hasLive ? null : <LiveEmptyState />}

            <p className={META_CLASS}>{`${describeReport(chosen)}, model ${report.model}.`}</p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat
                    isCard
                    size="sm"
                    label="Cases run"
                    value={formatNumber(summary.cases)}
                    detail={summary.skipped > 0 ? `${summary.skipped} skipped` : undefined}
                />
                <Stat isCard size="sm" label="Checks passed" value={`${formatNumber(summary.passedChecks)} of ${formatNumber(summary.checks)}`} />
                <Stat isCard size="sm" label="Tokens" value={formatNumber(summary.tokens)} />
                <Stat isCard size="sm" label="Estimated cost" value={formatCost(summary.costUsd)} />
            </div>

            {cases.length === 0 ? (
                <EmptyState
                    icon={FlaskConical}
                    size="sm"
                    headingLevel={3}
                    title="No cases match these filters"
                    description="No case in this report calls one of the tools you chose."
                    primaryAction={
                        <Button variant="secondary" size="sm" onPress={handleReset}>
                            Clear eval filters
                        </Button>
                    }
                />
            ) : (
                <div className={WIDGET_GRID_CLASS}>
                    {shown("eval-grid") ? <EvalGridWidget cases={cases} types={evals.checkTypes} /> : null}
                    {shown("eval-tokens") ? <EvalTokensWidget cases={cases} sampleNote={sampleNote} /> : null}
                    {shown("eval-cost") ? <EvalCostWidget cases={cases} sampleNote={sampleNote} /> : null}
                </div>
            )}
        </div>
    );
}
