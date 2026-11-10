"use client";

import { useState } from "react";
import { Button } from "@eylulg/ui/button";
import { Dialog, DialogTrigger } from "@eylulg/ui/dialog";
import { IconButton } from "@eylulg/ui/icon-button";
import { Textarea } from "@eylulg/ui/textarea";
import { Settings } from "lucide-react";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/prompt";
import { MAX_SYSTEM_CHARS } from "@/lib/protocol";
import { useStudio } from "../studio-context";

function SettingsForm({ close }: { close: () => void }) {
    const saved = useStudio((state) => state.settings.systemPrompt);
    const setSystemPrompt = useStudio((state) => state.setSystemPrompt);
    const [draft, setDraft] = useState(saved || DEFAULT_SYSTEM_PROMPT);

    const tooLong = draft.length > MAX_SYSTEM_CHARS;
    const isDefault = draft.trim() === DEFAULT_SYSTEM_PROMPT.trim();

    function handleReset() {
        setDraft(DEFAULT_SYSTEM_PROMPT);
    }

    function handleSave() {
        setSystemPrompt(isDefault ? "" : draft.trim());
        close();
    }

    return (
        <div className="flex flex-col gap-4">
            <Textarea
                label="System prompt"
                hint={`Sent with every message and cached on the server side. ${draft.length} of ${MAX_SYSTEM_CHARS} characters.`}
                errorMessage={tooLong ? `Shorten the prompt by ${draft.length - MAX_SYSTEM_CHARS} characters.` : undefined}
                value={draft}
                onChange={setDraft}
                rows={14}
                font="data"
                resizable
            />
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onPress={handleReset} isDisabled={isDefault}>
                    Reset to default prompt
                </Button>
                <Button onPress={handleSave} isDisabled={tooLong || draft.trim() === ""}>
                    Save system prompt
                </Button>
            </div>
        </div>
    );
}

export function SettingsDialog() {
    return (
        <DialogTrigger>
            <IconButton icon={Settings} variant="tertiary" aria-label="Open settings" />
            <Dialog
                title="Settings"
                description="The system prompt tells the assistant how to behave. It applies to new messages in every conversation."
                size="lg"
            >
                {({ close }) => <SettingsForm close={close} />}
            </Dialog>
        </DialogTrigger>
    );
}
