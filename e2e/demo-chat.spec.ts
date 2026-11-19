import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

async function expectNoViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function ask(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
}

test('asks, approves a tool, stops, regenerates, forks and resumes in demo mode', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Demo mode.')).toBeVisible();
  await expectNoViolations(page);

  // Ask: an example prompt runs a tool on its own and the answer cites the result.
  await page.getByRole('button', { name: 'What is 18% of 2,450, plus 75?' }).click();
  const calculate = page.getByRole('region', { name: 'Tool call: calculate' });
  await expect(calculate.getByText('Done', { exact: true })).toBeVisible();
  await expect(calculate.getByRole('group', { name: 'Output of calculate' })).toContainText('516');
  await expect(page.getByRole('article', { name: 'Assistant answer, turn 1' })).toContainText(
    '516',
  );
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();

  // Tool approval: nothing runs until the user approves, and the edited input is what runs.
  await ask(page, 'Add a task to renew my passport by 2026-12-01, high priority.');
  const createTask = page.getByRole('region', { name: 'Tool call: create_task' });
  await expect(createTask.getByText('Needs approval')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tasks' })).toHaveCount(0);
  await createTask.getByRole('button', { name: 'Edit input' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit input for create_task' });
  await editor
    .getByRole('textbox', { name: 'Input as JSON' })
    .fill('{"title": "Renew passport online", "due": "2026-12-01", "priority": "high"}');
  await editor.getByRole('button', { name: 'Approve with this input' }).click();
  await expect(createTask).toBeFocused();
  await expect(createTask.getByText('Done', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Renew passport online'),
  ).toBeVisible();
  await expect(page.getByRole('article', { name: 'Assistant answer, turn 2' })).toContainText(
    'Done. The task is now in your list',
  );
  await expectNoViolations(page);

  // Stop keeps the partial answer.
  await ask(page, 'Show me a TypeScript debounce function.');
  await expect(page.getByRole('article', { name: 'Assistant answer, turn 3' })).toContainText(
    'Here is',
  );
  await page.getByRole('button', { name: 'Stop answer' }).click();
  await expect(page.getByText('Stopped. This is the answer so far.')).toBeVisible();
  await expect(page.getByRole('article', { name: 'Assistant answer, turn 3' })).toContainText(
    'Here is',
  );

  // Regenerate adds a second version of the answer.
  await page.getByRole('button', { name: 'Regenerate answer' }).click();
  await expect(page.getByRole('group', { name: 'ts code' })).toContainText('function debounce');
  await expect(page.getByText('2 / 2')).toBeVisible();
  await page.getByRole('button', { name: 'Previous version of answer, turn 3' }).click();
  await expect(page.getByText('1 / 2')).toBeVisible();

  // Fork: editing the first message starts a new branch, and the old one stays reachable.
  await page.getByRole('button', { name: 'Edit your message, turn 1' }).click();
  await page
    .getByRole('textbox', { name: 'Edit your message, turn 1' })
    .fill("What's the weather like in Oslo and Lisbon?");
  await page.getByRole('button', { name: 'Save as new version' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await expect(page.getByRole('article', { name: 'Assistant answer, turn 1' })).toContainText(
    'sample data',
    { timeout: 15_000 },
  );
  await expect(page.getByRole('article', { name: 'Your message, turn 1' })).toContainText(
    'weather',
  );
  await expect(page.getByRole('region', { name: 'Tool call: lookup_weather' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Previous version of your message, turn 1' }).click();
  await expect(page.getByRole('article', { name: 'Your message, turn 1' })).toContainText('18%');
  await expect(page.getByRole('article', { name: 'Assistant answer, turn 3' })).toBeVisible();

  // A dropped connection is an interruption, not an error, and Resume carries on from the partial answer.
  await ask(page, 'Explain how server-sent events work, step by step.');
  await expect(
    page.getByText('The connection was interrupted. Your answer so far is kept.'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Try again with Regenerate answer.')).toHaveCount(0);
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Resume answer' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await expect(page.getByRole('article', { name: /Assistant answer, turn 4/ })).toContainText(
    'interruption, not an error',
    { timeout: 15_000 },
  );

  // The session survives a reload.
  await page.reload();
  await expect(page.getByRole('article', { name: /Assistant answer, turn 4/ })).toContainText(
    'interruption, not an error',
  );
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Renew passport online'),
  ).toBeVisible();
  await expectNoViolations(page);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`has no accessibility violations or sideways scrolling at ${width}px in ${scheme} mode`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      await expectNoViolations(page);

      // A code block in an answer.
      await ask(page, 'Show me a TypeScript debounce function.');
      await expect(page.getByRole('group', { name: 'ts code' })).toContainText(
        'function debounce',
        { timeout: 15_000 },
      );
      await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
      await expectNoViolations(page);

      // A tool waiting for approval, and the editor for its input.
      await ask(page, 'Find my Kyoto notes and add a task to book the tea ceremony.');
      const createTask = page.getByRole('region', { name: 'Tool call: create_task' });
      await expect(createTask.getByText('Needs approval')).toBeVisible({ timeout: 15_000 });
      await expectNoViolations(page);
      await createTask.getByRole('button', { name: 'Edit input' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit input for create_task' })).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press('Escape');

      // Settings.
      await page.getByRole('button', { name: 'Open settings' }).click();
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press('Escape');

      if (width === 375) {
        await page.getByRole('button', { name: 'Conversations' }).click();
        await expect(page.getByRole('dialog', { name: 'Conversations' })).toBeVisible();
        await expectNoViolations(page);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^Tasks \(/ }).click();
        await expect(page.getByRole('dialog', { name: 'Tasks' })).toBeVisible();
        await expectNoViolations(page);
        await page.keyboard.press('Escape');
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
