"use client";

import { Button } from "@eylulg/ui/button";
import { EmptyState } from "@eylulg/ui/empty-state";
import { Sparkles } from "lucide-react";
import { SUGGESTED_PROMPTS } from "@/lib/suggestions";
import { useStudio } from "../studio-context";

function PromptButton({ prompt }: { prompt: string }) {
    const send = useStudio((state) => state.send);

    async function handlePress() {
        await send(prompt);
    }

    return (
        <Button variant="secondary" size="sm" onPress={handlePress} className="h-auto! min-h-control-sm justify-start py-2 text-left whitespace-normal">
            {prompt}
        </Button>
    );
}

export function EmptyChat() {
    return (
        // The content centres with auto margins, not justify-center, so a short screen scrolls from the top instead of cutting it off.
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="mx-auto my-auto flex w-full max-w-3xl flex-col gap-6 py-6">
                <EmptyState
                    icon={Sparkles}
                    headingLevel={2}
                    size="sm"
                    title="Ask the assistant something it needs a tool for"
                    description="It can calculate, convert units, tell the time, search a sample notebook, check sample weather and manage a task list. Changes to your tasks always wait for your approval."
                />
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Example prompts">
                    {SUGGESTED_PROMPTS.map((prompt) => (
                        <li key={prompt} className="flex">
                            <PromptButton prompt={prompt} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
