'use client';

import { Suspense, useMemo } from 'react';
import { PageHeader } from '@eylulg/ui/page-header';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ViewState, parseView, serializeView } from '@/lib/insights/filters';
import type { NamedReport } from '@/lib/insights/load-reports';
import { EvalsSection } from './evals-section';
import { SavedViews } from './saved-views';
import { NoConversations, UsageSection } from './usage-section';
import { useRecords } from './use-records';

function Loading() {
  return (
    <p role='status' className='text-sm text-tertiary'>
      Reading the conversations saved in this browser.
    </p>
  );
}

function Sections({ reports }: { reports: readonly NamedReport[] }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const records = useRecords();
  // The selectors remember their last result by identity, so the view must keep its identity until the URL changes.
  const view = useMemo(() => parseView(params), [params]);

  function setView(next: ViewState) {
    const query = serializeView(next).toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <>
      <section aria-labelledby='usage-heading' className='flex flex-col gap-4'>
        <h2 id='usage-heading' className='font-display text-xl font-semibold text-primary'>
          Usage
        </h2>
        <p className='text-sm text-tertiary'>Read from this browser. Nothing leaves it.</p>
        {records.status === 'loading' ? (
          <Loading />
        ) : records.records.length === 0 ? (
          <NoConversations />
        ) : (
          <UsageSection records={records.records} view={view} onChange={setView} />
        )}
      </section>
      <section aria-labelledby='evals-heading' className='flex flex-col gap-4'>
        <h2 id='evals-heading' className='font-display text-xl font-semibold text-primary'>
          Evals
        </h2>
        <p className='text-sm text-tertiary'>
          Results of the eval suite, read when the page was built.
        </p>
        <EvalsSection reports={reports} view={view} onChange={setView} />
      </section>
      <SavedViews view={view} onApply={setView} />
    </>
  );
}

export function Insights({ reports }: { reports: readonly NamedReport[] }) {
  return (
    <div className='flex flex-col gap-8 py-2'>
      <PageHeader
        title='Insights'
        description='Your usage in this browser, and how the eval suite scores the assistant.'
      />
      <Suspense fallback={<Loading />}>
        <Sections reports={reports} />
      </Suspense>
    </div>
  );
}
