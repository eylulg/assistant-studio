"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@eylulg/ui/button";
import { Drawer, DrawerTrigger } from "@eylulg/ui/drawer";
import { ListChecks, MessagesSquare } from "lucide-react";
import { fetchTransport } from "@/lib/chat/transport";
import { activePath } from "@/lib/chat/tree";
import { createStudioStore } from "@/store/studio-store";
import { Announcer } from "./chat/announcer";
import { ChatHeader } from "./chat/chat-header";
import { Composer } from "./chat/composer";
import { EmptyChat } from "./chat/empty-chat";
import { MessageList } from "./chat/message-list";
import { DemoBanner } from "./demo-banner";
import { ConversationList } from "./panels/conversation-list";
import { TaskPanel } from "./panels/task-panel";
import { StudioProvider, useStudio } from "./studio-context";
import { PANEL_CLASS } from "./styles";

function browserStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function createBrowserStore() {
    return createStudioStore({
        transport: fetchTransport,
        storage: browserStorage,
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
        schedule: (callback) => requestAnimationFrame(callback),
    });
}

function MobilePanels() {
    const taskCount = useStudio((state) => state.tasks.length);

    function renderConversations({ close }: { close: () => void }) {
        return <ConversationList onSelect={close} />;
    }

    return (
        <div className="flex gap-2 lg:hidden">
            <DrawerTrigger>
                <Button variant="secondary" size="sm" iconLeading={MessagesSquare}>
                    Conversations
                </Button>
                <Drawer title="Conversations" side="left" size="sm">
                    {renderConversations}
                </Drawer>
            </DrawerTrigger>
            <DrawerTrigger>
                <Button variant="secondary" size="sm" iconLeading={ListChecks}>
                    {`Tasks (${taskCount})`}
                </Button>
                <Drawer title="Tasks" side="right" size="sm">
                    <TaskPanel />
                </Drawer>
            </DrawerTrigger>
        </div>
    );
}

function Chat({ composerRef }: { composerRef: RefObject<HTMLTextAreaElement | null> }) {
    const hasMessages = useStudio((state) => {
        const conversation = state.activeId ? state.conversations[state.activeId] : undefined;
        return conversation ? activePath(conversation).length > 0 : false;
    });
    const conversation = useStudio((state) => (state.activeId ? state.conversations[state.activeId] : undefined));

    return (
        <section aria-label="Chat" className="flex h-[calc(100dvh-13rem)] min-h-[44rem] min-w-0 flex-col sm:min-h-[34rem]">
            <ChatHeader />
            {conversation && hasMessages ? <MessageList conversation={conversation} /> : <EmptyChat />}
            <Composer textareaRef={composerRef} />
        </section>
    );
}

export function Studio({ demo }: { demo: boolean }) {
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const [value] = useState(() => ({
        store: createBrowserStore(),
        demo,
        focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus()),
    }));
    const { store } = value;

    useEffect(() => {
        store.getState().hydrate();
        function handlePageHide() {
            store.getState().persistNow();
        }
        window.addEventListener("pagehide", handlePageHide);
        return () => window.removeEventListener("pagehide", handlePageHide);
    }, [store]);

    return (
        <StudioProvider {...value}>
            <div className="flex flex-col gap-4">
                <h1 className="sr-only">Assistant Studio</h1>
                {demo ? <DemoBanner /> : null}
                <MobilePanels />
                <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)_18rem]">
                    <aside aria-label="Conversation list" className="hidden lg:block">
                        <h2 className="pb-3 text-sm font-semibold text-primary">Conversations</h2>
                        <ConversationList />
                    </aside>
                    <Chat composerRef={composerRef} />
                    <aside aria-label="Task list" className={`${PANEL_CLASS} hidden h-fit p-4 lg:block`}>
                        <h2 className="pb-3 text-sm font-semibold text-primary">Tasks</h2>
                        <TaskPanel />
                    </aside>
                </div>
                <Announcer />
            </div>
        </StudioProvider>
    );
}
