export const ACCEPTED_FILE_TYPES = ['.txt', '.md', '.pdf'] as const;

/** Per file, before reading. A PDF this size is already well over the model's page limit for most layouts. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Extracted text across the documents of one conversation. About 100,000 tokens, so a live request stays affordable. */
export const MAX_TOTAL_CHARS = 400_000;

/** Original bytes across the documents of one conversation. PDFs are sent to the model as files, so this bounds the request. */
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

export const MAX_DOCUMENTS = 10;

/** The API takes at most this many PDF pages in one request, counted over all the PDFs of the request. */
export const MAX_PDF_PAGES = 600;

/** The most a request body can carry for documents: base64 grows the bytes by a third, plus a margin for names and JSON. */
export const MAX_DOCUMENT_BODY_BYTES =
  Math.ceil((MAX_TOTAL_BYTES * 4) / 3) + MAX_TOTAL_CHARS * 4 + 100_000;
