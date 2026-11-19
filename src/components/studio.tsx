"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { Button } from "@eylulg/ui/button";
import { Drawer, DrawerTrigger } from "@eylulg/ui/drawer";
import { FileText, ListChecks, MessagesSquare } from "lucide-react";
import { createTransport } from "@/lib/chat/transport";
import { activePath } from "@/lib/chat/tree";
import { createIndexedDbRepository } from "@/lib/documents/repository";
import { createDocumentsStore } from "@/store/documents-store";
import { createStudioStore } from "@/store/studio-store";
import { Announcer } from "./chat/announcer";
import { ChatHeader } from "./chat/chat-header";
import { Composer } from "./chat/composer";
import { EmptyChat } from "./chat/empty-chat";
import { MessageList } from "./chat/message-list";
import { DemoBanner } from "./demo-banner";
import { ConversationList } from "./panels/conversation-list";
import { SourcesPanel } from "./panels/sources-panel";
import { TaskPanel } from "./panels/task-panel";
import { StudioProvider, useDemoMode, useDocuments, useStudio } from "./studio-context";
import { PANEL_CLASS } from "./styles";

function browserStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function createBrowserStores(demo: boolean) {
    const documents = createDocumentsStore({
        repository: createIndexedDbRepository(),
        newId: () => crypto.randomUUID(),
        now: () => new Date(),
    });
    const store = createStudioStore({
        transport: createTransport({ demo }),
        documents: (conversationId) => documents.getState().forQuestion(conversationId),
        storage: browserStorage,
        now: () => new Date(),
        newId: () => crypto.randomUUID(),
        schedule: (callback) => requestAnimationFrame(callback),
    });
    return { store, documents };
}

function MobilePanels() {
    const taskCount = useStudio((state) => state.tasks.length);
    const activeId = useStudio((state) => state.activeId);
    const documentCount = useDocuments((state) => (activeId ? (state.entries[activeId]?.length ?? 0) : 0));
    const demo = useDemoMode();

    function renderConversations({ close }: { close: () => void }) {
        return <ConversationList onSelect={close} />;
    }

    return (
        <div className="flex flex-wrap gap-2 lg:hidden">
            <DrawerTrigger>
                <Button variant="secondary" size="sm" iconLeading={MessagesSquare}>
                    Conversations
                </Button>
                <Drawer title="Conversations" side="left" size="sm">
                    {renderConversations}
                </Drawer>
            </DrawerTrigger>
            <DrawerTrigger>
                <Button variant="secondary" size="sm" iconLeading={FileText}>
                    {`Sources (${documentCount})`}
                </Button>
                <Drawer title="Sources" side="right" size="sm">
                    <SourcesPanel demo={demo} />
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
        ...createBrowserStores(demo),
        demo,
        focusComposer: () => requestAnimationFrame(() => composerRef.current?.focus()),
    }));
    const { store, documents } = value;

    useEffect(() => {
        function loadDocuments(conversationId: string | null) {
            if (conversationId) documents.getState().load(conversationId);
        }
        store.getState().hydrate();
        loadDocuments(store.getState().activeId);
        // Documents belong to a conversation: they load with it and go when it is deleted.
        const unsubscribe = store.subscribe((state, previous) => {
            if (state.activeId !== previous.activeId) loadDocuments(state.activeId);
            for (const id of Object.keys(previous.conversations)) {
                if (!(id in state.conversations)) documents.getState().removeConversation(id);
            }
        });
        function handlePageHide() {
            store.getState().persistNow();
        }
        window.addEventListener("pagehide", handlePageHide);
        return () => {
            unsubscribe();
            window.removeEventListener("pagehide", handlePageHide);
        };
    }, [store, documents]);

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
                    <div className="hidden h-fit flex-col gap-6 lg:flex">
                        <aside aria-label="Sources" className={`${PANEL_CLASS} p-4`}>
                            <h2 className="pb-3 text-sm font-semibold text-primary">Sources</h2>
                            <SourcesPanel demo={demo} />
                        </aside>
                        <aside aria-label="Task list" className={`${PANEL_CLASS} p-4`}>
                            <h2 className="pb-3 text-sm font-semibold text-primary">Tasks</h2>
                            <TaskPanel />
                        </aside>
                    </div>
                </div>
                <Announcer />
            </div>
        </StudioProvider>
    );
}
