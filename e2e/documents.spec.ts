import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { buildPdf } from './pdf';

const REFUNDS = `Refund policy

Customers can return any product within 30 days of delivery for a full refund. Items must be unused and in the original packaging.

Shipping costs are not refunded unless the item arrived damaged. Damaged items must be reported with a photo within 7 days.

Warranty

All hardware carries a two year warranty covering manufacturing defects. Water damage and accidental drops are not covered.
`;

const HANDBOOK = buildPdf([
  [
    'Travel policy',
    'Employees may book economy flights for trips under six hours.',
    'Business class needs written approval from a director.',
  ],
  [
    'Expenses',
    'Meals are reimbursed up to 40 euros per day while travelling.',
    'Receipts must be uploaded within 14 days of the trip.',
  ],
]);

async function expectNoViolations(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function ask(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
}

function addFiles(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  return page
    .getByRole('complementary', { name: 'Sources' })
    .locator('input[type=file]')
    .setInputFiles(files);
}

/** The switch input sits under its label, so the label is what a pointer reaches. */
function toggle(page: Page, name: string) {
  return page.getByRole('switch', { name }).locator('xpath=ancestor::label').click();
}

function storedEnabled(page: Page) {
  return page.evaluate(
    () =>
      new Promise<boolean | undefined>((resolve, reject) => {
        const open = indexedDB.open('assistant-studio');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('documents').objectStore('documents').getAll();
          all.onsuccess = () =>
            resolve((all.result[0] as { enabled: boolean } | undefined)?.enabled);
        };
      }),
  );
}

const FILES = [
  { name: 'handbook.pdf', mimeType: 'application/pdf', buffer: HANDBOOK },
  { name: 'refunds.txt', mimeType: 'text/plain', buffer: Buffer.from(REFUNDS) },
  { name: 'scan.pdf', mimeType: 'application/pdf', buffer: buildPdf([['']]) },
  { name: 'blank.txt', mimeType: 'text/plain', buffer: Buffer.from('  \n') },
  {
    name: 'notes.docx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('not a document'),
  },
];

test('adds documents, explains the files it refuses, answers with cited quotes and opens the source at the range', async ({
  page,
}) => {
  const chatBodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/chat')) chatBodies.push(request.postData() ?? '');
  });
  await page.goto('/');

  await addFiles(page, FILES);

  const documents = page.getByRole('list', { name: 'Documents' });
  await expect(documents.getByRole('listitem').filter({ hasText: 'handbook.pdf' })).toContainText(
    'in 2 pages',
  );
  await expect(documents.getByRole('listitem').filter({ hasText: 'refunds.txt' })).toContainText(
    'characters',
  );
  await expect(documents).toContainText('no text layer');
  await expect(documents).toContainText('has no text in it');
  await expect(documents).toContainText('not supported');
  await expectNoViolations(page);
  await page.getByRole('button', { name: 'Remove scan.pdf' }).click();
  await page.getByRole('button', { name: 'Remove blank.txt' }).click();
  await page.getByRole('button', { name: 'Remove notes.docx' }).click();
  await expect(documents.getByRole('listitem')).toHaveCount(2);

  await ask(page, 'How many days do customers have to return a product?');
  const answer = page.getByRole('article', { name: 'Assistant answer, turn 1' });
  await expect(answer).toContainText('Extractive answer');
  await expect(answer).toContainText('No model was called');
  await expect(answer).toContainText('within 30 days of delivery');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expectNoViolations(page);

  // The chip opens the source by keyboard, highlights the cited range and gives focus back on close.
  const chip = answer.getByRole('button', { name: 'Source 1: refunds.txt' });
  await chip.focus();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'Source 1: refunds.txt' });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('mark')).toContainText('within 30 days of delivery');
  await expect(viewer.locator('mark')).toBeInViewport();
  await expectNoViolations(page);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(chip).toBeFocused();

  // A PDF citation names its page, and the viewer shows that page.
  await toggle(page, 'Use refunds.txt');
  await ask(page, 'How much are meals reimbursed per day?');
  const second = page.getByRole('article', { name: 'Assistant answer, turn 2' });
  const pdfChip = second.getByRole('button', { name: 'Source 1: handbook.pdf, page 2' });
  await expect(pdfChip).toBeVisible();
  await pdfChip.click();
  await expect(
    page.getByRole('dialog', { name: 'Source 1: handbook.pdf, page 2' }).locator('mark'),
  ).toContainText('40 euros per day');
  await page.keyboard.press('Escape');

  // The documents were read and answered from in the browser: not one chat request was made.
  expect(chatBodies).toEqual([]);
});

test('keeps documents and their switches across a reload, and answers honestly when nothing matches', async ({
  page,
}) => {
  await page.goto('/');
  await addFiles(page, FILES.slice(1, 2));
  await expect(page.getByRole('switch', { name: 'Use refunds.txt' })).toBeChecked();
  await toggle(page, 'Use refunds.txt');
  await expect.poll(() => storedEnabled(page)).toBe(false);

  await page.reload();

  await expect(page.getByRole('list', { name: 'Documents' })).toContainText('refunds.txt');
  await expect(page.getByRole('switch', { name: 'Use refunds.txt' })).not.toBeChecked();

  await toggle(page, 'Use refunds.txt');
  await ask(page, 'Who won the 1998 World Cup?');
  const answer = page.getByRole('article', { name: 'Assistant answer, turn 1' });
  await expect(answer).toContainText('Nothing in your documents matches');
  await expect(answer.getByRole('button', { name: /^Source/ })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [375, 1280]) {
    test(`has no accessibility violations or sideways scrolling with documents at ${width}px in ${scheme} mode`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      const panel =
        width === 375
          ? await (async () => {
              await page.getByRole('button', { name: /^Sources \(/ }).click();
              return page.getByRole('dialog', { name: 'Sources' });
            })()
          : page.getByRole('complementary', { name: 'Sources' });

      await panel.locator('input[type=file]').setInputFiles(FILES);
      await expect(panel.getByRole('list', { name: 'Documents' })).toContainText('in 2 pages');
      await expect(panel.getByRole('list', { name: 'Documents' })).toContainText('not supported');
      await expectNoViolations(page);
      if (width === 375) await page.keyboard.press('Escape');

      await ask(page, 'How many days do customers have to return a product?');
      await expect(page.getByRole('button', { name: 'Source 1: refunds.txt' })).toBeVisible();
      await expectNoViolations(page);
      await page.getByRole('button', { name: 'Source 1: refunds.txt' }).click();
      await expect(page.getByRole('dialog', { name: 'Source 1: refunds.txt' })).toBeVisible();
      await expectNoViolations(page);
      await page.keyboard.press('Escape');

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
