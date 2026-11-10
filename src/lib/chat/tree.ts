import type { AssistantMessage, Conversation, Message, MessageNode, UserMessage } from "./types";

const ROOT = "root";

function parentKey(parentId: string | null): string {
    return parentId ?? ROOT;
}

export function createConversation(id: string, now: string): Conversation {
    return { id, title: "New conversation", createdAt: now, updatedAt: now, nodes: {}, order: [], active: {} };
}

export function childrenOf(conversation: Conversation, parentId: string | null): MessageNode[] {
    return conversation.order.flatMap((id) => {
        const node = conversation.nodes[id];
        return node && node.parentId === parentId ? [node] : [];
    });
}

/** The messages on screen: from the first message, follow the chosen sibling at every step (the latest one until someone chooses). */
export function activePath(conversation: Conversation): MessageNode[] {
    const path: MessageNode[] = [];
    let parentId: string | null = null;
    while (true) {
        const siblings: MessageNode[] = childrenOf(conversation, parentId);
        const chosen: string | undefined = conversation.active[parentKey(parentId)];
        const node: MessageNode | undefined = siblings.find((sibling) => sibling.id === chosen) ?? siblings[siblings.length - 1];
        if (!node) return path;
        path.push(node);
        parentId = node.id;
    }
}

export function appendMessage(conversation: Conversation, parentId: string | null, message: Message, now: string): Conversation {
    const title = conversation.order.length === 0 && message.role === "user" ? titleFrom(message.text) : conversation.title;
    return {
        ...conversation,
        title,
        updatedAt: now,
        nodes: { ...conversation.nodes, [message.id]: { id: message.id, parentId, message } },
        order: [...conversation.order, message.id],
        active: { ...conversation.active, [parentKey(parentId)]: message.id },
    };
}

/** Editing an earlier user message adds a sibling under the same parent and switches to it. The old branch stays reachable. */
export function forkUserMessage(conversation: Conversation, nodeId: string, message: UserMessage, now: string): Conversation {
    const node = conversation.nodes[nodeId];
    if (!node || node.message.role !== "user") return conversation;
    return appendMessage(conversation, node.parentId, message, now);
}

export function selectVersion(conversation: Conversation, nodeId: string): Conversation {
    const node = conversation.nodes[nodeId];
    if (!node) return conversation;
    return { ...conversation, active: { ...conversation.active, [parentKey(node.parentId)]: nodeId } };
}

export function versionsOf(conversation: Conversation, nodeId: string): { index: number; count: number; previousId?: string; nextId?: string } {
    const node = conversation.nodes[nodeId];
    const siblings = node ? childrenOf(conversation, node.parentId) : [];
    const index = siblings.findIndex((sibling) => sibling.id === nodeId);
    return { index, count: siblings.length, previousId: siblings[index - 1]?.id, nextId: siblings[index + 1]?.id };
}

export function updateAssistant(conversation: Conversation, nodeId: string, update: (message: AssistantMessage) => AssistantMessage): Conversation {
    const node = conversation.nodes[nodeId];
    if (!node || node.message.role !== "assistant") return conversation;
    return { ...conversation, nodes: { ...conversation.nodes, [nodeId]: { ...node, message: update(node.message) } } };
}

/** The messages from the first one down to and including `nodeId`, following parents, whatever branch is showing. */
export function pathTo(conversation: Conversation, nodeId: string): MessageNode[] {
    const path: MessageNode[] = [];
    let current: MessageNode | undefined = conversation.nodes[nodeId];
    while (current) {
        path.unshift(current);
        current = current.parentId ? conversation.nodes[current.parentId] : undefined;
    }
    return path;
}

function titleFrom(text: string): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean || "New conversation";
}
