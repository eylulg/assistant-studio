import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Studio } from '../studio';

// The only thing stubbed is the network: fetch goes straight to the real route handler, which replays the recordings.
async function bridgeFetchToRoute() {
  const { POST } = await import('@/app/api/chat/route');
  vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
    POST(
      new Request(`http://localhost${url}`, {
        ...init,
        headers: { ...init.headers, host: 'localhost' },
      }),
    ),
  );
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('textbox', { name: 'Message' }), `${text}{Enter}`);
}

describe('Studio in demo mode', () => {
  beforeEach(async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('DEMO_PACE', '0');
    window.localStorage.clear();
    await bridgeFetchToRoute();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('runs a tool by itself and writes the answer from its result', async () => {
    const user = userEvent.setup();
    render(<Studio demo />);

    await user.click(screen.getByRole('button', { name: 'What is 18% of 2,450, plus 75?' }));

    const card = await screen.findByRole('region', { name: 'Tool call: calculate' });
    expect(await within(card).findByText('Done')).toBeVisible();
    expect(within(card).getByRole('group', { name: 'Output of calculate' })).toHaveTextContent(
      '"result": 516',
    );
    expect(await screen.findByText(/is 441, and adding 75 gives/)).toBeVisible();
  });

  it('holds a task until it is approved, then adds it, moves focus to the card and lets the answer continue', async () => {
    const user = userEvent.setup();
    render(<Studio demo />);

    await ask(user, 'Add a task to renew my passport by 2026-12-01, high priority.');
    const card = await screen.findByRole('region', { name: 'Tool call: create_task' });
    await within(card).findByRole('button', { name: 'Approve' });
    expect(screen.queryByRole('list', { name: 'Tasks' })).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Approve' }));

    expect(card).toHaveFocus();
    expect(
      await screen.findByText('Done. The task is now in your list in the side panel.'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Tasks' })).getByText('Renew passport'),
    ).toBeVisible();
  });

  it('tells the assistant when the user denies a task, and adds nothing', async () => {
    const user = userEvent.setup();
    render(<Studio demo />);

    await ask(user, 'Add a task to renew my passport by 2026-12-01, high priority.');
    await user.click(await screen.findByRole('button', { name: 'Deny' }));

    expect(await screen.findByText(/I won't add it/)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Tasks' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tool call: create_task' })).toHaveTextContent(
      'Denied',
    );
  });

  it('shows an interrupted answer with Resume instead of an error, and finishes it', async () => {
    const user = userEvent.setup();
    render(<Studio demo />);

    await ask(user, 'Explain how server-sent events work, step by step.');
    const resume = await screen.findByRole('button', { name: 'Resume answer' });
    expect(
      screen.getByText('The connection was interrupted. Your answer so far is kept.'),
    ).toBeVisible();
    expect(screen.queryByText(/Try again with Regenerate answer/)).not.toBeInTheDocument();

    await user.click(resume);

    expect(await screen.findByText(/interruption, not an error/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Resume answer' })).not.toBeInTheDocument();
  });

  it('forks when a message is edited and lets the user step back to the first version', async () => {
    const user = userEvent.setup();
    render(<Studio demo />);
    await user.click(screen.getByRole('button', { name: 'What is 18% of 2,450, plus 75?' }));
    await screen.findByText(/is 441, and adding 75 gives/);

    await user.click(screen.getByRole('button', { name: 'Edit your message, turn 1' }));
    await user.clear(screen.getByRole('textbox', { name: 'Edit your message, turn 1' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Edit your message, turn 1' }),
      'In one sentence, what does a mutex do?',
    );
    await user.click(screen.getByRole('button', { name: 'Save as new version' }));

    expect(await screen.findByText(/lets only one thread at a time/)).toBeVisible();
    expect(screen.getByText('2 / 2')).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Previous version of your message, turn 1' }),
    );

    expect(screen.getByText(/is 441, and adding 75 gives/)).toBeVisible();
    expect(screen.queryByText(/lets only one thread/)).not.toBeInTheDocument();
  });
});
