import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Looking at a CSV before importing it.
 *
 * The preview endpoint exists on BOTH importers and was never called:
 * the panel went presign → PUT → process, committing the file before the
 * seller could see what we made of it. That is the expensive order of
 * operations, because a CSV with an unmappable column does not fail
 * loudly — it fails one row at a time into an error report read
 * afterwards, by which point the good rows are already orders.
 *
 * It matters more since the landmark became required: a seller with a
 * saved template is now missing a column, and the difference between
 * being told at upload and being told per-row is the whole file.
 */

const PANEL = join(__dirname, '../app/(authed)/orders/_components/csv-import-panel.tsx');
const src = readFileSync(PANEL, 'utf8');

describe('the preview happens before the import', () => {
  it('calls /preview after the upload', () => {
    expect(src).toContain('`${endpointBase}/preview`');
  });

  it('does NOT call /process from the upload path', () => {
    // The upload function must end at the preview. Committing there is
    // the bug this closes.
    const upload = src.slice(
      src.indexOf('async function upload('),
      src.indexOf('async function confirmImport('),
    );
    expect(upload).not.toContain('/process');
    expect(upload).toContain('setPending(');
  });

  it('/process is reached only by an explicit confirm', () => {
    const confirm = src.slice(src.indexOf('async function confirmImport('));
    expect(confirm.slice(0, 800)).toContain('`${endpointBase}/process`');
  });
});

describe('what the preview refuses to let through', () => {
  it('blocks the import when a required column is missing', () => {
    // Every row would fail. Letting it proceed turns one fixable mistake
    // into a per-row error report.
    expect(src).toContain('pending.preview.missingRequired.length > 0');
    expect(src).toMatch(/disabled=\{[\s\S]{0,200}missingRequired\.length > 0/);
  });

  it('blocks a file over the row limit', () => {
    expect(src).toContain('pending.preview.exceedsRowLimit');
  });

  it('names the missing columns rather than saying "invalid file"', () => {
    expect(src).toContain('pending.preview.missingRequired.join');
  });
});

describe('what it tells the seller', () => {
  it('shows the row count and says nothing has been imported yet', () => {
    expect(src).toContain('Nothing has been imported yet');
  });

  it('surfaces the suggestion for an unmatched column, not just the name', () => {
    // "Phone No is ignored" is a shrug; "did you mean customerPhone" is
    // a fix.
    expect(src).toContain('did you mean');
    expect(src).toContain('u.suggestion !== null');
  });

  it('shows the field → column mapping it derived', () => {
    expect(src).toContain('Object.entries(pending.preview.mapping)');
  });

  it('offers a way out that imports nothing', () => {
    expect(src).toContain('Discard');
  });
});

describe('the button no longer promises to process', () => {
  it('says it will check, because that is what it now does', () => {
    // It read "Upload + process", which described the bug.
    expect(src).toContain('Upload and check');
    expect(src).not.toContain('Upload + process');
  });
});
