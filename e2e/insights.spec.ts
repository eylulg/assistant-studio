import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

async function expectNoViolations(page: Page) {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

/** Asks two real questions in demo mode, so the page has answers the app itself produced. */
async function askTwoQuestions(page: Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "What is 18% of 2,450, plus 75?" }).click();
    await expect(page.getByRole("region", { name: "Tool call: calculate" }).getByText("Done", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).fill("Show me a TypeScript debounce function.");
    await page.getByRole("textbox", { name: "Message" }).press("Enter");
    await expect(page.getByRole("group", { name: "ts code" })).toContainText("function debounce", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
    await page.waitForFunction(() => (window.localStorage.getItem("assistant-studio:v1") ?? "").split('"status":"complete"').length > 2);
}

test("explains what will appear when there are no conversations and links to the studio", async ({ page }) => {
    await page.goto("/insights");

    await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No live report yet" })).toBeVisible();
    await expect(page.getByLabel("Command for a live eval run")).toContainText("npm run eval:live");
    await page.getByRole("link", { name: "Open the studio" }).click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
});

test("filters by keyboard, keeps the filters in the URL, hides a widget and restores a saved view", async ({ page }) => {
    await askTwoQuestions(page);
    await page.getByRole("link", { name: "Insights" }).click();
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
    await expect(page.getByText("2 of 2 answers.")).toBeVisible();
    await expect(page.getByRole("term").filter({ hasText: "Answers" }).first()).toBeVisible();

    // The chart keeps its table.
    const answers = page.getByRole("figure", { name: "Answers over time" });
    await answers.getByRole("button", { name: "Show table" }).click();
    await expect(answers.getByRole("table")).toBeVisible();

    // A filter is a real checkbox: reach it with Tab and set it with Space.
    await page.getByText("Filters and widgets").first().click();
    const tool = page.getByRole("checkbox", { name: "Tool: calculate" });
    await tool.focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/tool=calculate/);
    await expect(page.getByText("1 of 2 answers.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("1 of 2 answers.")).toBeVisible();
    await page.getByText("Filters and widgets").first().click();
    await expect(page.getByRole("checkbox", { name: "Tool: calculate" })).toBeChecked();

    // A hidden widget is not on the page at all.
    await page.getByRole("checkbox", { name: "Usage widgets: Cache-read share" }).focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/hide=cache/);
    await expect(page.getByRole("figure", { name: "Cache-read share" })).toHaveCount(0);

    // A saved view holds the filters and the hidden widget.
    await page.getByRole("textbox", { name: "View name" }).fill("Calculator only");
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved the view Calculator only." })).toBeAttached();
    await page.goto("/insights");
    await expect(page.getByText("2 of 2 answers.")).toBeVisible();
    await page.getByRole("button", { name: /Saved views/ }).click();
    await page.getByRole("option", { name: "Calculator only" }).click();
    await expect(page).toHaveURL(/tool=calculate/);
    await expect(page).toHaveURL(/hide=cache/);
    await expect(page.getByText("1 of 2 answers.")).toBeVisible();

    // Deleting the last view moves focus to the name field, because the list is empty and disabled.
    await page.getByRole("button", { name: "Delete view" }).click();
    await expect(page.getByRole("textbox", { name: "View name" })).toBeFocused();
});

for (const scheme of ["light", "dark"] as const) {
    for (const width of [375, 1280]) {
        test(`has no accessibility violations or sideways scrolling at ${width}px in ${scheme} mode`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: scheme });

            await page.goto("/insights");
            await expect(page.getByRole("heading", { name: "No conversations yet" })).toBeVisible();
            await expectNoViolations(page);

            await askTwoQuestions(page);
            await page.goto("/insights");
            await expect(page.getByText("2 of 2 answers.")).toBeVisible();
            await page.getByText("Filters and widgets").first().click();
            await expect(page.getByRole("figure", { name: "Latency distribution" })).toBeVisible();
            await expectNoViolations(page);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        });
    }
}
