import { Info } from 'lucide-react';

export function DemoBanner() {
  return (
    <p className='flex items-start gap-2 rounded-lg bg-secondary px-4 py-2.5 text-sm text-secondary'>
      <Info aria-hidden='true' className='mt-0.5 size-4 shrink-0 text-fg-brand' />
      <span>
        <strong className='font-semibold'>Demo mode.</strong> No model API key is set on this
        server, so the assistant replays sample answers written ahead of time and I can only answer
        the example prompts. The tools, the approval step and the task list are real. No tokens are
        spent.
      </span>
    </p>
  );
}
