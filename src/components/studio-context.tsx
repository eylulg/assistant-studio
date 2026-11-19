"use client";

import { type ReactNode, createContext, useContext } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { DocumentsState } from "@/store/documents-store";
import type { StudioState } from "@/store/studio-store";

interface StudioContextValue {
    store: StoreApi<StudioState>;
    documents: StoreApi<DocumentsState>;
    /** No API key on the server: answers replay recordings. */
    demo: boolean;
    /** Moves focus to the message box. Used after an action removes the control that had focus. */
    focusComposer: () => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children, ...value }: StudioContextValue & { children: ReactNode }) {
    return <StudioContext value={value}>{children}</StudioContext>;
}

function useStudioContext(): StudioContextValue {
    const value = useContext(StudioContext);
    if (!value) throw new Error("useStudio must be used inside StudioProvider.");
    return value;
}

export function useStudio<T>(selector: (state: StudioState) => T): T {
    return useStore(useStudioContext().store, selector);
}

export function useDemoMode(): boolean {
    return useStudioContext().demo;
}

export function useFocusComposer(): () => void {
    return useStudioContext().focusComposer;
}

export function useDocuments<T>(selector: (state: DocumentsState) => T): T {
    return useStore(useStudioContext().documents, selector);
}

/** Adds files to the open conversation, starting one first when there is none yet. */
export function useAddDocuments(): (files: File[]) => Promise<void> {
    const { store, documents } = useStudioContext();
    return async (files) => {
        if (files.length === 0) return;
        const open = store.getState().activeId;
        if (!open || !store.getState().conversations[open]) store.getState().newConversation();
        const conversationId = store.getState().activeId;
        if (conversationId) await documents.getState().add(conversationId, files);
    };
}
