/** Builds a small text PDF, one line list per page, so the end-to-end tests exercise the real PDF reader without a binary fixture. */
export function buildPdf(pages: string[][]): Buffer {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body);
    const pageIds: number[] = [];
    add("<< /Type /Catalog /Pages 2 0 R >>");
    add("PAGES");
    add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    for (const lines of pages) {
        const escaped = lines.map((line) => line.replace(/[\\()]/g, "\\$&"));
        const stream = `BT /F1 12 Tf 14 TL 56 740 Td ${escaped.map((line) => `(${line}) Tj T*`).join(" ")} ET`;
        add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${objects.length} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
        pageIds.push(objects.length);
    }
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let output = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
        offsets.push(output.length);
        output += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(output, "latin1");
}
