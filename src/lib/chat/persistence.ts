import { type PersistedState, persistedStateSchema } from './types';

export const STORAGE_KEY = 'assistant-studio:v1';
const MAX_CONVERSATIONS = 30;

export function emptyState(model: string): PersistedState {
  return {
    version: 1,
    conversations: {},
    order: [],
    activeId: null,
    settings: { model, systemPrompt: '' },
    tasks: [],
  };
}

/** A page that closed mid-stream cannot still be streaming. Those answers become interrupted and can be resumed. */
function settleStale(state: PersistedState): PersistedState {
  const conversations = Object.fromEntries(
    Object.entries(state.conversations).map(([id, conversation]) => [
      id,
      {
        ...conversation,
        nodes: Object.fromEntries(
          Object.entries(conversation.nodes).map(([nodeId, node]) => {
            if (node.message.role !== 'assistant' || node.message.status !== 'streaming')
              return [nodeId, node];
            const parts = node.message.parts.map((part) =>
              part.type === 'tool' && (part.status === 'streaming' || part.status === 'running')
                ? {
                    ...part,
                    status: 'cancelled' as const,
                    output: 'The page was closed before this finished.',
                  }
                : part,
            );
            return [
              nodeId,
              { ...node, message: { ...node.message, status: 'interrupted' as const, parts } },
            ];
          }),
        ),
      },
    ]),
  );
  return { ...state, conversations };
}

/** Reads saved state. Anything missing, unreadable or in an old shape gives `null`, never an exception. */
export function loadState(storage: Pick<Storage, 'getItem'> | null): PersistedState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? settleStale(parsed.data) : null;
  } catch {
    return null;
  }
}

/** Keeps the most recent conversations so the saved state stays within the browser's quota. */
function trim(state: PersistedState): PersistedState {
  if (state.order.length <= MAX_CONVERSATIONS) return state;
  const keep = new Set(state.order.slice(0, MAX_CONVERSATIONS));
  return {
    ...state,
    order: state.order.filter((id) => keep.has(id)),
    conversations: Object.fromEntries(
      Object.entries(state.conversations).filter(([id]) => keep.has(id)),
    ),
    activeId: state.activeId && keep.has(state.activeId) ? state.activeId : null,
  };
}

/** Returns false when the browser refuses (quota, private mode, blocked storage). */
export function saveState(
  storage: Pick<Storage, 'setItem'> | null,
  state: PersistedState,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(trim(state)));
    return true;
  } catch {
    return false;
  }
}
