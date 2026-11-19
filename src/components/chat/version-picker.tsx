'use client';

import { IconButton } from '@eylulg/ui/icon-button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { META_CLASS } from '@/components/styles';
import { useStudio } from '../studio-context';

interface VersionPickerProps {
  /** "your message" or "answer", used in the accessible names. */
  noun: string;
  turn: number;
  index: number;
  count: number;
  previousId?: string;
  nextId?: string;
}

/** Steps between the versions of one turn: edited messages and regenerated answers are siblings in the conversation tree. */
export function VersionPicker({
  noun,
  turn,
  index,
  count,
  previousId,
  nextId,
}: VersionPickerProps) {
  const selectVersion = useStudio((state) => state.selectVersion);
  const isBusy = useStudio((state) => state.streaming !== null);

  function handlePrevious() {
    if (previousId) selectVersion(previousId);
  }

  function handleNext() {
    if (nextId) selectVersion(nextId);
  }

  if (count < 2) return null;

  return (
    <div className='flex items-center gap-1'>
      <IconButton
        icon={ChevronLeft}
        size='sm'
        variant='tertiary'
        aria-label={`Previous version of ${noun}, turn ${turn}`}
        isDisabled={!previousId || isBusy}
        onPress={handlePrevious}
      />
      <span className={META_CLASS}>
        <span className='sr-only'>Version </span>
        {index + 1} / {count}
      </span>
      <IconButton
        icon={ChevronRight}
        size='sm'
        variant='tertiary'
        aria-label={`Next version of ${noun}, turn ${turn}`}
        isDisabled={!nextId || isBusy}
        onPress={handleNext}
      />
    </div>
  );
}
