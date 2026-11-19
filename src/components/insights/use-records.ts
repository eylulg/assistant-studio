'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { STORAGE_KEY, loadState } from '@/lib/chat/persistence';
import { type AnswerRecord, toRecords } from '@/lib/insights/records';

type Raw = string | null | undefined;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function readRaw(): Raw {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** On the server and during hydration the storage has not been read, which is different from it being empty. */
function readOnServer(): Raw {
  return undefined;
}

export type RecordsState =
  { status: 'loading' } | { status: 'ready'; records: AnswerRecord[]; conversations: number };

/**
 * The answers saved in this browser by the studio, read from the same storage key and checked with the same schema.
 * Nothing is fetched and nothing is kept elsewhere. Another tab that saves a new answer updates the page.
 */
export function useRecords(): RecordsState {
  const raw = useSyncExternalStore(subscribe, readRaw, readOnServer);

  return useMemo<RecordsState>(() => {
    if (raw === undefined) return { status: 'loading' };
    const state = loadState({ getItem: () => raw });
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      status: 'ready',
      records: state ? toRecords(state.conversations, timeZone) : [],
      conversations: state ? Object.keys(state.conversations).length : 0,
    };
  }, [raw]);
}
