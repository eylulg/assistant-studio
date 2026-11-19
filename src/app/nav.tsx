'use client';

import { ProjectSwitcher, ThemeToggle, TopNav } from '@eylulg/ui/chrome';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Nav() {
  const pathname = usePathname();

  return (
    <TopNav
      productName='Assistant Studio'
      LinkComponent={Link}
      links={[
        { href: '/', label: 'Studio', isCurrent: pathname === '/' },
        { href: '/insights', label: 'Insights', isCurrent: pathname === '/insights' },
      ]}
      actions={
        <>
          <ProjectSwitcher currentId='assistant-studio' />
          <ThemeToggle />
        </>
      }
      compactActions={<ThemeToggle compact />}
    />
  );
}
