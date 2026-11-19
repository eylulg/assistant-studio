'use client';

import { Button } from '@eylulg/ui/button';
import { IconButton } from '@eylulg/ui/icon-button';
import { Plus, Trash2 } from 'lucide-react';
import { META_CLASS } from '@/components/styles';
import { useStudio } from '../studio-context';

function ConversationRow({ id, onSelect }: { id: string; onSelect?: () => void }) {
  const title = useStudio((state) => state.conversations[id]?.title ?? '');
  const isActive = useStudio((state) => state.activeId === id);
  const isBusy = useStudio((state) => state.streaming !== null);
  const selectConversation = useStudio((state) => state.selectConversation);
  const deleteConversation = useStudio((state) => state.deleteConversation);

  function handleSelect() {
    selectConversation(id);
    onSelect?.();
  }

  function handleDelete() {
    deleteConversation(id);
  }

  return (
    <li className='flex items-center gap-1'>
      <Button
        variant={isActive ? 'secondary' : 'tertiary'}
        size='sm'
        aria-current={isActive ? 'true' : undefined}
        isDisabled={isBusy && !isActive}
        onPress={handleSelect}
        className='min-w-0 flex-1 justify-start overflow-hidden'
      >
        <span className='truncate'>{title}</span>
      </Button>
      <IconButton
        icon={Trash2}
        size='sm'
        variant='tertiary'
        aria-label={`Delete conversation: ${title}`}
        isDisabled={isBusy}
        onPress={handleDelete}
      />
    </li>
  );
}

export function ConversationList({ onSelect }: { onSelect?: () => void }) {
  const order = useStudio((state) => state.order);
  const isBusy = useStudio((state) => state.streaming !== null);
  const persistence = useStudio((state) => state.persistence);
  const newConversation = useStudio((state) => state.newConversation);

  function handleNew() {
    newConversation();
    onSelect?.();
  }

  return (
    <nav aria-label='Conversations' className='flex flex-col gap-3'>
      <Button
        variant='secondary'
        size='sm'
        iconLeading={Plus}
        isDisabled={isBusy}
        onPress={handleNew}
      >
        New conversation
      </Button>
      {order.length === 0 ? (
        <p className='text-sm text-secondary'>Your conversations will appear here.</p>
      ) : (
        <ul className='flex flex-col gap-1'>
          {order.map((id) => (
            <ConversationRow key={id} id={id} onSelect={onSelect} />
          ))}
        </ul>
      )}
      <p className={META_CLASS}>
        {persistence === 'failed'
          ? 'Not saved: this browser blocked storage or it is full.'
          : 'Saved in this browser only.'}
      </p>
    </nav>
  );
}
