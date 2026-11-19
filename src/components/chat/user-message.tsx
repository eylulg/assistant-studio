'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@eylulg/ui/button';
import { IconButton } from '@eylulg/ui/icon-button';
import { Textarea } from '@eylulg/ui/textarea';
import { Pencil } from 'lucide-react';
import type { UserMessage as UserMessageData } from '@/lib/chat/types';
import { useFocusComposer, useStudio } from '../studio-context';
import { VersionPicker } from './version-picker';

interface UserMessageProps {
  message: UserMessageData;
  turn: number;
  versions: { index: number; count: number; previousId?: string; nextId?: string };
}

export function UserMessage({ message, turn, versions }: UserMessageProps) {
  const editMessage = useStudio((state) => state.editMessage);
  const isBusy = useStudio((state) => state.streaming !== null);
  const focusComposer = useFocusComposer();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus();
  }, [isEditing]);

  const unchanged = draft.trim() === message.text.trim();

  function handleStartEdit() {
    setDraft(message.text);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    // The edit button is back after this render, so focus returns to where the user started.
    requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  async function handleSave() {
    setEditing(false);
    focusComposer();
    await editMessage(message.id, draft);
  }

  return (
    <article aria-label={`Your message, turn ${turn}`} className='flex flex-col items-end gap-2'>
      {isEditing ? (
        <div className='flex w-full flex-col gap-2'>
          <Textarea
            ref={textareaRef}
            label={`Edit your message, turn ${turn}`}
            value={draft}
            onChange={setDraft}
            rows={3}

            hint='Saving starts a new branch. The original stays one version back.'
          />
          <div className='flex justify-end gap-2'>
            <Button variant='secondary' size='sm' onPress={handleCancel}>
              Cancel edit
            </Button>
            <Button size='sm' isDisabled={unchanged || draft.trim() === ''} onPress={handleSave}>
              Save as new version
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className='max-w-[85%] rounded-xl bg-secondary px-4 py-3 text-md whitespace-pre-wrap text-primary'>
            {message.text}
          </p>
          <div className='flex items-center gap-1'>
            <VersionPicker noun='your message' turn={turn} {...versions} />
            <IconButton
              ref={editButtonRef}
              icon={Pencil}
              size='sm'
              variant='tertiary'
              aria-label={`Edit your message, turn ${turn}`}
              isDisabled={isBusy}
              onPress={handleStartEdit}
            />
          </div>
        </>
      )}
    </article>
  );
}
