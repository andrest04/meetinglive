/**
 * Tiny, valid PDF, DOCX and PPTX files built in memory, for the extraction tests and the manual
 * check. Nothing here is shipped behavior.
 */
import JSZip from 'jszip';

/** A PDF with one line of Helvetica text per page. Text must be plain ASCII without parens. */
export function buildPdf(pages: readonly string[]): Uint8Array {
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${String(3 + i * 2)} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  const font = 3 + pages.length * 2;
  pages.forEach((text, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${String(font)} 0 R >> >> /Contents ${String(4 + i * 2)} 0 R >>`,
    );
    const stream = text === '' ? '' : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

const xmlEscape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A DOCX with one paragraph per string. */
export async function buildDocx(paragraphs: readonly string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${xmlEscape(p)}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * A PPTX whose slides are listed in `presentation.xml` in the given order. The part names run
 * backwards (the first slide shown is the last file), so a reader that sorts file names fails.
 */
export async function buildPptx(slides: readonly (readonly string[])[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const n = slides.length;
  const partFor = (i: number): number => n - i;
  const ids = slides
    .map((_, i) => `<p:sldId id="${String(256 + i)}" r:id="rId${String(i + 10)}"/>`)
    .join('');
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
  );
  const rels = slides
    .map(
      (_, i) =>
        `<Relationship Target="slides/slide${String(partFor(i))}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Id="rId${String(i + 10)}"/>`,
    )
    .join('');
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  slides.forEach((paragraphs, i) => {
    const body = paragraphs
      .map((p) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(p)}</a:t></a:r></a:p>`)
      .join('');
    zip.file(
      `ppt/slides/slide${String(partFor(i))}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generateAsync({ type: 'uint8array' });
}
