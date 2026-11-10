"use client";

import { Button } from "@eylulg/ui/button";
import { Download } from "lucide-react";
import { conversationToMarkdown } from "@/lib/chat/markdown-export";
import { activePath } from "@/lib/chat/tree";
import { SettingsDialog } from "../panels/settings-dialog";
import { useStudio } from "../studio-context";

function fileName(title: string): string {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return `${slug || "conversation"}.md`;
}

export function ChatHeader() {
    const conversation = useStudio((state) => (state.activeId ? state.conversations[state.activeId] : undefined));
    const hasMessages = conversation ? activePath(conversation).length > 0 : false;

    function handleExport() {
        if (!conversation) return;
        const url = URL.createObjectURL(new Blob([conversationToMarkdown(conversation)], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName(conversation.title);
        link.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-3">
            <h2 className="min-w-0 basis-full truncate text-lg font-semibold text-primary sm:flex-1 sm:basis-0">
                {hasMessages && conversation ? conversation.title : "New conversation"}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
                <Button variant="tertiary" size="sm" iconLeading={Download} isDisabled={!hasMessages} onPress={handleExport}>
                    Export Markdown
                </Button>
                <SettingsDialog />
            </div>
        </div>
    );
}
