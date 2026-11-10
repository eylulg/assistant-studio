"use client";

import { type FormEvent, type Ref, useState } from "react";
import { Button } from "@eylulg/ui/button";
import { Kbd } from "@eylulg/ui/kbd";
import { Select, SelectItem } from "@eylulg/ui/select";
import { Textarea } from "@eylulg/ui/textarea";
import { ArrowUp, Square } from "lucide-react";
import type { Key, KeyboardEvent } from "react-aria-components";
import { META_CLASS } from "@/components/styles";
import { MODEL_OPTIONS } from "@/lib/models";
import { useStudio } from "../studio-context";

export function Composer({ textareaRef }: { textareaRef: Ref<HTMLTextAreaElement> }) {
    const send = useStudio((state) => state.send);
    const stop = useStudio((state) => state.stop);
    const setModel = useStudio((state) => state.setModel);
    const model = useStudio((state) => state.settings.model);
    const isStreaming = useStudio((state) => state.streaming !== null);
    const [text, setText] = useState("");

    async function submit() {
        const clean = text.trim();
        if (!clean || isStreaming) return;
        setText("");
        await send(clean);
    }

    async function handleKeyDown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            await submit();
        } else if (event.key === "Escape" && isStreaming) {
            stop();
        }
    }

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        await submit();
    }

    function handleModelChange(key: Key | null) {
        if (typeof key === "string") setModel(key);
    }

    return (
        <form className="mx-auto flex w-full max-w-3xl flex-col gap-3 border-t border-subtle bg-primary pt-3 pb-1" onSubmit={handleSubmit}>
            <Textarea
                ref={textareaRef}
                aria-label="Message"
                placeholder="Ask something, or ask for a calculation, your notes or a task"
                rows={2}
                value={text}
                onChange={setText}
                onKeyDown={handleKeyDown}
            />
            <div className="flex flex-wrap items-end justify-between gap-3">
                <Select aria-label="Model" selectedKey={model} onSelectionChange={handleModelChange} isDisabled={isStreaming} className="w-full sm:w-64">
                    {MODEL_OPTIONS.map((option) => (
                        <SelectItem key={option.id} id={option.id} textValue={option.label} description={option.description}>
                            {option.label}
                        </SelectItem>
                    ))}
                </Select>
                <div className="flex items-center gap-3">
                    <span className={`${META_CLASS} hidden sm:inline`}>
                        <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd> + <Kbd>Enter</Kbd> adds a line
                        {isStreaming ? (
                            <>
                                , <Kbd>Esc</Kbd> stops
                            </>
                        ) : null}
                    </span>
                    {isStreaming ? (
                        <Button variant="secondary" iconLeading={Square} onPress={stop}>
                            Stop answer
                        </Button>
                    ) : (
                        <Button type="submit" iconLeading={ArrowUp} isDisabled={text.trim() === ""}>
                            Send message
                        </Button>
                    )}
                </div>
            </div>
        </form>
    );
}
