import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_VIEW, type ViewState } from "@/lib/insights/filters";
import { SavedViews } from "../saved-views";

const hidden: ViewState = { ...EMPTY_VIEW, hidden: ["cache"] };

describe("SavedViews", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("keeps focus in the name field after Save view clears the name and disables the button", async () => {
        const user = userEvent.setup();
        render(<SavedViews view={hidden} onApply={vi.fn()} />);

        await user.type(screen.getByRole("textbox", { name: "View name" }), "Cache hidden");
        await user.click(screen.getByRole("button", { name: "Save view" }));

        expect(screen.getByRole("textbox", { name: "View name" })).toHaveFocus();
        expect(screen.getByRole("status")).toHaveTextContent("Saved the view Cache hidden.");
    });

    it("shows the saved view only while the filters still equal it", async () => {
        const user = userEvent.setup();
        const { rerender } = render(<SavedViews view={hidden} onApply={vi.fn()} />);
        await user.type(screen.getByRole("textbox", { name: "View name" }), "Cache hidden");
        await user.click(screen.getByRole("button", { name: "Save view" }));
        expect(screen.getByRole("button", { name: /Saved views/ })).toHaveTextContent("Cache hidden");

        rerender(<SavedViews view={EMPTY_VIEW} onApply={vi.fn()} />);

        expect(screen.getByRole("button", { name: /Saved views/ })).toHaveTextContent("Choose a view");
    });

    it("keeps the readable views and says so when one entry in storage is damaged", () => {
        window.localStorage.setItem(
            "assistant-studio:insight-views:v1",
            JSON.stringify({
                version: 1,
                views: [
                    { id: "a", name: "Good", view: hidden },
                    { id: "b", name: "", view: hidden },
                ],
            }),
        );

        render(<SavedViews view={hidden} onApply={vi.fn()} />);

        expect(screen.getByRole("button", { name: /Saved views/ })).toHaveTextContent("Good");
        expect(screen.getByText(/Some saved views could not be read/)).toBeVisible();
    });
});
