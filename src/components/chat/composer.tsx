"use client";

import { type FormEvent, type Ref, useState } from "react";
import { Button } from "@eylulg/ui/button";
import { IconButton } from "@eylulg/ui/icon-button";
import { Kbd } from "@eylulg/ui/kbd";
import { Select, SelectItem } from "@eylulg/ui/select";
import { Textarea } from "@eylulg/ui/textarea";
import { ArrowUp, Paperclip, Square } from "lucide-react";
import { DropZone, type DropZoneProps, FileTrigger, type Key, type KeyboardEvent, isFileDropItem } from "react-aria-components";
import { META_CLASS } from "@/components/styles";
import { ACCEPTED_FILE_TYPES } from "@/lib/documents/limits";
import { MODEL_OPTIONS } from "@/lib/models";
import { useAddDocuments, useDocuments, useStudio } from "../studio-context";

export function Composer({ textareaRef }: { textareaRef: Ref<HTMLTextAreaElement> }) {
    const send = useStudio((state) => state.send);
    const stop = useStudio((state) => state.stop);
    const setModel = useStudio((state) => state.setModel);
    const model = useStudio((state) => state.settings.model);
    const isStreaming = useStudio((state) => state.streaming !== null);
    const storageBlocked = useDocuments((state) => state.storage === "unavailable");
    const addDocuments = useAddDocuments();
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

    async function handleDrop(event: Parameters<NonNullable<DropZoneProps["onDrop"]>>[0]) {
        const files = await Promise.all(event.items.filter(isFileDropItem).map((item) => item.getFile()));
        await addDocuments(files);
    }

    async function handleFilesChosen(files: FileList | null) {
        await addDocuments(files ? [...files] : []);
    }

    function handleModelChange(key: Key | null) {
        if (typeof key === "string") setModel(key);
    }

    return (
        <DropZone
            aria-label="Drop documents here to add them"
            isDisabled={storageBlocked}
            onDrop={handleDrop}
            className="data-drop-target:outline-brand mx-auto w-full max-w-3xl rounded-lg data-drop-target:bg-brand-subtle data-drop-target:outline-2 data-drop-target:outline-dashed"
        >
            <form className="flex w-full flex-col gap-3 border-t border-subtle bg-primary pt-3 pb-1" onSubmit={handleSubmit}>
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
                        <FileTrigger acceptedFileTypes={ACCEPTED_FILE_TYPES} allowsMultiple onSelect={handleFilesChosen}>
                            <IconButton icon={Paperclip} variant="secondary" aria-label="Attach documents" isDisabled={storageBlocked} />
                        </FileTrigger>
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
        </DropZone>
    );
}
