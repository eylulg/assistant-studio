import { assemblePages } from "@/lib/documents/extract";
import type { StoredDocument } from "@/lib/documents/types";

/** Sample documents for the evals. They are authored for this repository and describe an invented shop and an invented company. */

const REFUND_POLICY = `Refund policy

Customers can return any product within 30 days of delivery for a full refund. Items must be unused and in the original packaging.

Shipping costs are not refunded unless the item arrived damaged. Damaged items must be reported with a photo within 7 days.

Warranty

All hardware carries a two year warranty covering manufacturing defects. Water damage and accidental drops are not covered.

Support

Our support team answers email within one business day and phone calls from 9:00 to 17:00 on weekdays.
`;

const HANDBOOK_PAGES = [
    "Travel policy\n\nEmployees may book economy flights for trips under six hours.\nBusiness class needs written approval from a director.",
    "Expenses\n\nMeals are reimbursed up to 40 euros per day while travelling.\nReceipts must be uploaded within 14 days of the trip.",
    "Equipment\n\nLaptops are replaced every four years. Request a replacement through the IT desk.",
];

function document(id: string, name: string, kind: StoredDocument["kind"], text: string, pages?: StoredDocument["pages"]): StoredDocument {
    return { id, conversationId: "eval", name, kind, size: text.length, text, pages, enabled: true, createdAt: "2026-11-10T09:30:00.000Z" };
}

const handbook = assemblePages(HANDBOOK_PAGES);

export const FIXTURES: Record<string, StoredDocument> = {
    "refund-policy": document("refund-policy", "refund-policy.txt", "text", REFUND_POLICY),
    "travel-handbook": document("travel-handbook", "travel-handbook.pdf", "pdf", handbook.text, handbook.pages),
};

export function fixture(id: string): StoredDocument {
    const found = FIXTURES[id];
    if (!found) throw new Error(`No eval document "${id}".`);
    return found;
}
