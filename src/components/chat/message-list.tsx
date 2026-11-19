'use client';

import { useEffect, useRef } from 'react';
import { MESSAGE_COLUMN_CLASS } from '@/components/styles';
import { activePath, versionsOf } from '@/lib/chat/tree';
import type { Conversation } from '@/lib/chat/types';
import { AssistantMessage } from './assistant-message';
import { UserMessage } from './user-message';

const NEAR_BOTTOM_PX = 96;

/** A cheap fingerprint of the last answer, so the list can follow it as it grows. */
function tailSize(conversation: Conversation): number {
  const last = activePath(conversation).at(-1)?.message;
  if (last?.role !== 'assistant') return 0;
  return last.parts.reduce(
    (size, part) =>
      size +
      (part.type === 'text'
        ? part.text.length
        : part.type === 'tool'
          ? 1 + (part.output?.length ?? 0)
          : 0),
    last.status.length,
  );
}

export function MessageList({ conversation }: { conversation: Conversation }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const path = activePath(conversation);
  const size = tailSize(conversation);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    followingRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (element && followingRef.current) element.scrollTop = element.scrollHeight;
  }, [size, path.length]);

  // The turn number of a node is how many user messages are on the path up to it.
  const turns = path.map(
    (_, index) => path.slice(0, index + 1).filter((node) => node.message.role === 'user').length,
  );
  return (
    <div
      ref={scrollRef}
      role='region'
      aria-label='Conversation'
      // A scrollable region has to be reachable by keyboard so it can be scrolled without a mouse.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      onScroll={handleScroll}
      className='min-h-0 flex-1 overflow-y-auto px-1 py-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'
    >
      <div className={MESSAGE_COLUMN_CLASS}>
        {path.map((node, index) => {
          const turn = turns[index] ?? 1;
          if (node.message.role === 'user')
            return (
              <UserMessage
                key={node.id}
                message={node.message}
                turn={turn}
                versions={versionsOf(conversation, node.id)}
              />
            );
          return (
            <AssistantMessage
              key={node.id}
              message={node.message}
              turn={turn}
              versions={versionsOf(conversation, node.id)}
              isLast={index === path.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}
