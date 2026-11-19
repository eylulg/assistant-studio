'use client';

import { useRef, useState } from 'react';
import { Badge, type BadgeColor } from '@eylulg/ui/badge';
import { Button } from '@eylulg/ui/button';
import { CodeBlock } from '@eylulg/ui/code-block';
import { Dialog } from '@eylulg/ui/dialog';
import { Spinner } from '@eylulg/ui/spinner';
import { Textarea } from '@eylulg/ui/textarea';
import {
  Calculator,
  Clock,
  CloudSun,
  ListChecks,
  ListPlus,
  type LucideIcon,
  Ruler,
  Search,
  Wrench,
} from 'lucide-react';
import { PANEL_CLASS } from '@/components/styles';
import type { ToolPart, ToolStatus } from '@/lib/chat/types';
import { findTool, validateInput } from '@/lib/tools';
import { useStudio } from '../studio-context';

interface ToolCardProps {
  assistantId: string;
  part: ToolPart;
}

const ICONS: Record<string, LucideIcon> = {
  calculate: Calculator,
  convert_units: Ruler,
  get_time: Clock,
  search_notes: Search,
  create_task: ListPlus,
  list_tasks: ListChecks,
  lookup_weather: CloudSun,
};

const STATUS: Record<ToolStatus, { label: string; color: BadgeColor }> = {
  streaming: { label: 'Preparing', color: 'gray' },
  awaiting_approval: { label: 'Needs approval', color: 'warning' },
  running: { label: 'Running', color: 'blue' },
  done: { label: 'Done', color: 'success' },
  error: { label: 'Failed', color: 'error' },
  denied: { label: 'Denied', color: 'gray' },
  cancelled: { label: 'Cancelled', color: 'gray' },
};

const SECTION_CLASS = 'flex flex-col gap-1.5 [&_pre]:max-h-56';
const LABEL_CLASS = 'text-xs font-medium text-secondary';

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function inputText(part: ToolPart): string {
  if (part.input) return JSON.stringify(part.input, null, 2);
  return part.rawInput ? part.rawInput : '{}';
}

function EditFooter({
  close,
  onApprove,
}: {
  close: () => void;
  onApprove: (close: () => void) => void;
}) {
  function handleApprove() {
    onApprove(close);
  }

  return (
    <>
      <Button variant='secondary' onPress={close}>
        Cancel edit
      </Button>
      <Button onPress={handleApprove}>Approve with this input</Button>
    </>
  );
}

function EditInputDialog({
  part,
  isOpen,
  onOpenChange,
  onApprove,
}: {
  part: ToolPart;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (input: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(inputText(part));
  const [error, setError] = useState<string | undefined>();

  function handleApprove(close: () => void) {
    const tool = findTool(part.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError('This is not valid JSON. Check the quotes and commas.');
      return;
    }
    const result = tool ? validateInput(tool, parsed) : null;
    if (
      !result?.ok ||
      typeof result.input !== 'object' ||
      result.input === null ||
      Array.isArray(result.input)
    ) {
      setError(result && !result.ok ? result.error : 'This input is not accepted by the tool.');
      return;
    }
    close();
    onApprove(Object.fromEntries(Object.entries(result.input)));
  }

  function renderFooter({ close }: { close: () => void }) {
    return <EditFooter close={close} onApprove={handleApprove} />;
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Edit input for ${part.name}`}
      description='Change the values, then approve. The tool runs with your version, and the assistant is told what ran.'
      footer={renderFooter}
    >
      <Textarea
        label='Input as JSON'
        value={draft}
        onChange={setDraft}
        errorMessage={error}
        rows={8}
        font='data'
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
      />
    </Dialog>
  );
}

export function ToolCard({ assistantId, part }: ToolCardProps) {
  const approveTool = useStudio((state) => state.approveTool);
  const denyTool = useStudio((state) => state.denyTool);
  const cardRef = useRef<HTMLElement>(null);
  const [isEditing, setEditing] = useState(false);

  const Icon = ICONS[part.name] ?? Wrench;
  const status = STATUS[part.status];
  const edited = part.approvedInput !== undefined;

  // Approving removes the buttons, so focus moves to the card first and stays there while the answer continues.
  async function handleApprove() {
    cardRef.current?.focus();
    await approveTool(assistantId, part.id);
  }

  async function handleApproveEdited(input: Record<string, unknown>) {
    // The dialog still traps focus for a frame while it closes.
    requestAnimationFrame(() => cardRef.current?.focus());
    await approveTool(assistantId, part.id, input);
  }

  async function handleDeny() {
    cardRef.current?.focus();
    await denyTool(assistantId, part.id);
  }

  function handleEdit() {
    setEditing(true);
  }

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-label={`Tool call: ${part.name}`}
      className={`${PANEL_CLASS} flex flex-col gap-3 p-3 outline-none focus-visible:outline-2 focus-visible:outline-focus`}
    >
      <header className='flex flex-wrap items-center gap-2'>
        <Icon aria-hidden='true' className='size-4 text-fg-brand' />
        <span className='font-data text-sm font-medium text-primary'>{part.name}</span>
        <Badge color={status.color} size='sm'>
          {status.label}
        </Badge>
        {part.status === 'running' || part.status === 'streaming' ? <Spinner size='sm' /> : null}
        {part.durationMs !== undefined ? (
          <span className='ml-auto text-xs text-tertiary'>{part.durationMs} ms</span>
        ) : null}
      </header>

      <div className={SECTION_CLASS}>
        <p className={LABEL_CLASS}>Input</p>
        <CodeBlock label={`Input of ${part.name}`} wrap>
          {inputText(part)}
        </CodeBlock>
      </div>

      {edited ? (
        <div className={SECTION_CLASS}>
          <p className={LABEL_CLASS}>Input you approved</p>
          <CodeBlock label={`Approved input of ${part.name}`} wrap>
            {JSON.stringify(part.approvedInput, null, 2)}
          </CodeBlock>
        </div>
      ) : null}

      {part.output !== undefined ? (
        <div className={SECTION_CLASS}>
          <p className={LABEL_CLASS}>{part.status === 'done' ? 'Output' : 'Result'}</p>
          <CodeBlock label={`Output of ${part.name}`} wrap>
            {pretty(part.output)}
          </CodeBlock>
        </div>
      ) : null}

      {part.status === 'awaiting_approval' ? (
        <div className='flex flex-col gap-2 rounded-lg bg-warning-subtle p-3'>
          <p className='text-sm text-primary'>
            This changes your data, so it does not run until you approve it.
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button size='sm' onPress={handleApprove}>
              Approve
            </Button>
            <Button size='sm' variant='secondary' onPress={handleEdit}>
              Edit input
            </Button>
            <Button size='sm' variant='destructive-outline' onPress={handleDeny}>
              Deny
            </Button>
          </div>
          {isEditing ? (
            <EditInputDialog
              part={part}
              isOpen={isEditing}
              onOpenChange={setEditing}
              onApprove={handleApproveEdited}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
