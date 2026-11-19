"use client";

import type { ReactNode } from "react";
import { Button } from "@eylulg/ui/button";
import { ChevronRight, RotateCcw } from "lucide-react";

interface FilterPanelProps {
    /** How many filters differ from the default. Shown in the summary so a closed panel still says something is on. */
    activeCount: number;
    resetLabel: string;
    onReset: () => void;
    children: ReactNode;
}

/** The filters and widget toggles of a section, in a native disclosure so the page stays short on a phone. */
export function FilterPanel({ activeCount, resetLabel, onReset, children }: FilterPanelProps) {
    return (
        <details className="group rounded-xl border border-subtle bg-primary">
            <summary className="flex min-h-control-md cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="size-4 text-tertiary transition-transform group-open:rotate-90" />
                Filters and widgets
                {activeCount > 0 ? <span className="text-tertiary">{`(${activeCount} on)`}</span> : null}
            </summary>
            <div className="flex flex-col gap-4 border-t border-subtle p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
                <div>
                    <Button variant="secondary" size="sm" iconLeading={RotateCcw} onPress={onReset} isDisabled={activeCount === 0}>
                        {resetLabel}
                    </Button>
                </div>
            </div>
        </details>
    );
}
