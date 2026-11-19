'use client';

import { Badge, type BadgeColor } from '@eylulg/ui/badge';
import { Checkbox } from '@eylulg/ui/checkbox';
import { IconButton } from '@eylulg/ui/icon-button';
import { Trash2 } from 'lucide-react';
import { META_CLASS } from '@/components/styles';
import type { Task } from '@/lib/tools/types';
import { useStudio } from '../studio-context';

const PRIORITY_COLOR: Record<Task['priority'], BadgeColor> = {
  low: 'gray',
  normal: 'blue',
  high: 'orange',
};

function TaskRow({ task }: { task: Task }) {
  const toggleTask = useStudio((state) => state.toggleTask);
  const removeTask = useStudio((state) => state.removeTask);

  function handleToggle() {
    toggleTask(task.id);
  }

  function handleRemove() {
    removeTask(task.id);
  }

  return (
    <li className='flex items-start gap-2 rounded-lg border border-subtle p-3'>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <Checkbox isSelected={task.done} onChange={handleToggle}>
          <span className={task.done ? 'text-tertiary line-through' : undefined}>{task.title}</span>
        </Checkbox>
        <div className='flex flex-wrap items-center gap-1.5 pl-7'>
          <Badge size='sm' color={PRIORITY_COLOR[task.priority]}>
            {task.priority} priority
          </Badge>
          {task.due ? <span className={META_CLASS}>Due {task.due}</span> : null}
        </div>
      </div>
      <IconButton
        icon={Trash2}
        size='sm'
        variant='tertiary'
        aria-label={`Remove task: ${task.title}`}
        onPress={handleRemove}
      />
    </li>
  );
}

export function TaskPanel() {
  const tasks = useStudio((state) => state.tasks);

  return (
    <div className='flex flex-col gap-3'>
      {tasks.length === 0 ? (
        <p className='text-sm text-secondary'>
          No tasks yet. Ask the assistant to add one and approve it when it asks.
        </p>
      ) : (
        <ul className='flex flex-col gap-2' aria-label='Tasks'>
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}
      <p className={META_CLASS}>Tasks are saved in this browser only.</p>
    </div>
  );
}
