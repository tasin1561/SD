/**
 * Put a generated PDF in front of somebody — on paper or on disk.
 *
 * Two verbs because they are two different intents. PRINT is what the
 * flow is for: the sheet goes to the printer and the confirmation modal
 * follows. DOWNLOAD is the escape hatch for when the printer is
 * elsewhere, or somebody wants to keep the file.
 *
 * Both work from base64 rather than a URL: the API returns the bytes
 * inline, so there is no second authenticated fetch to get wrong, and no
 * temporary link that could be shared with somebody who should not have
 * the customer's address.
 */
function toBlobUrl(pdfBase64: string): string {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export function downloadPdf(pdfBase64: string, fileName: string): void {
  const url = toBlobUrl(pdfBase64);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a timer rather than immediately: Safari has not finished
  // reading the blob when click() returns, and revoking straight away
  // gives an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function printPdf(pdfBase64: string, fileName: string): void {
  const url = toBlobUrl(pdfBase64);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = url;
  frame.onload = (): void => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // A browser that will not print an iframe (or a popup blocker
      // that ate it) still leaves the operator with a file — falling
      // back is better than a button that appears to do nothing.
      downloadPdf(pdfBase64, fileName);
    }
  };
  document.body.appendChild(frame);
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
