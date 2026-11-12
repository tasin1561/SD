import { inflateSync } from 'node:zlib';

/**
 * The visible text of a PDF we generated, for asserting on a label or a
 * sheet without a rendering dependency.
 *
 * Deliberately narrow: it understands the output of OUR pdfkit documents
 * and nothing else. pdfkit writes text as `TJ` arrays of HEX strings in
 * the standard fonts' WinAnsi encoding, so a hex pair is simply a byte —
 * no ToUnicode map involved. Literal `(...)` strings are handled too,
 * since pdfkit emits those for some runs.
 *
 * A PDF from ELSEWHERE (a courier's own label, say) usually carries
 * subset fonts whose hex is glyph ids rather than characters; this would
 * return mojibake for one, so do not point it at a foreign document.
 */
export function extractPdfText(pdf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  while (true) {
    const s = pdf.indexOf('stream', i);
    if (s === -1) break;
    const e = pdf.indexOf('endstream', s);
    if (e === -1) break;
    let start = s + 'stream'.length;
    if (pdf[start] === 0x0d) start++;
    if (pdf[start] === 0x0a) start++;
    const raw = pdf.subarray(start, e);
    i = e + 1;

    let body: string;
    try {
      body = inflateSync(raw).toString('latin1');
    } catch {
      continue; // fonts and images are not text streams
    }
    if (!/T[jJ]/.test(body)) continue;

    // One text run per BT…ET block, so the pieces of a kerned word
    // ("MENEV ST" + "ORE") join back into the word a reader sees rather
    // than arriving as separate lines that no assertion can match.
    for (const block of body.match(/BT[\s\S]*?ET/g) ?? []) {
      let run = '';
      for (const m of block.match(/<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\()])*\)/g) ?? []) {
        if (m.startsWith('<')) {
          const hex = m.slice(1, -1).replace(/[^0-9A-Fa-f]/g, '');
          for (let k = 0; k + 1 < hex.length; k += 2) {
            run += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
          }
        } else {
          run += m
            .slice(1, -1)
            .replace(/\\(\d{1,3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
            .replace(/\\([()\\])/g, '$1');
        }
      }
      if (run.trim() !== '') out.push(run);
    }
  }
  return out.join('\n');
}
