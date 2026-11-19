"use client";

import { Checkbox } from "@eylulg/ui/checkbox";
import { FIELDSET_CLASS, LEGEND_CLASS, META_CLASS } from "@/components/styles";

interface FilterOption<T extends string> {
    value: T;
    label: string;
}

interface CheckboxFilterProps<T extends string> {
    legend: string;
    options: readonly FilterOption<T>[];
    selected: readonly T[];
    onChange: (next: T[]) => void;
    /** Shown when no value occurs yet, so an empty group does not look broken. */
    emptyText?: string;
}

interface OptionProps<T extends string> {
    legend: string;
    option: FilterOption<T>;
    selected: readonly T[];
    onChange: (next: T[]) => void;
}

function Option<T extends string>({ legend, option, selected, onChange }: OptionProps<T>) {
    const isSelected = selected.includes(option.value);

    function handleChange(next: boolean) {
        onChange(next ? [...selected, option.value] : selected.filter((value) => value !== option.value));
    }

    // The group name is part of each box's name, so the same value in two groups ("calculate") stays distinguishable.
    return (
        <Checkbox isSelected={isSelected} onChange={handleChange} aria-label={`${legend}: ${option.label}`}>
            {option.label}
        </Checkbox>
    );
}

/** A group of checkboxes for one filter. Nothing checked means no restriction. */
export function CheckboxFilter<T extends string>({ legend, options, selected, onChange, emptyText = "None yet" }: CheckboxFilterProps<T>) {
    return (
        <fieldset className={FIELDSET_CLASS}>
            <legend className={LEGEND_CLASS}>{legend}</legend>
            {options.length === 0 ? (
                <p className={META_CLASS}>{emptyText}</p>
            ) : (
                <div className="flex max-h-40 flex-col gap-2 overflow-y-auto py-0.5 pe-1">
                    {options.map((option) => (
                        <Option key={option.value} legend={legend} option={option} selected={selected} onChange={onChange} />
                    ))}
                </div>
            )}
        </fieldset>
    );
}
