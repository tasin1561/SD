/**
 * Let the browser complete a `mock://` upload — RECORDING RIG ONLY.
 *
 * WHY THIS EXISTS. Local object storage is a stub: `DEV_MOCK_SPACES=true`
 * makes `SpacesService.presignPutUrl` hand back a `mock://<bucket>/<key>`
 * string and keeps objects on local disk under `/tmp/skydrop-spaces-mock`.
 * The seller's CSV panel then does a real
 * `fetch(uploadUrl, { method: 'PUT', body: file })` — which is exactly
 * right against DigitalOcean and cannot work here for TWO independent
 * reasons:
 *
 *   1. `mock:` is not a scheme Chromium can fetch. The promise rejects
 *      before anything leaves the page.
 *   2. Even a real URL to another origin would be refused: apps/seller is
 *      served by `next start` (a production build), so its CSP is the real
 *      one and `connect-src` does not admit an arbitrary host.
 *
 * SO THE FIX IS A JS-LEVEL OVERRIDE, NOT A NETWORK ONE. `page.route` would
 * not help — there is no request to intercept, and a CSP refusal happens
 * before routing. Wrapping `window.fetch` means the PUT never becomes a
 * request at all: the bytes go straight to Node through an exposed
 * binding, Node writes them where `SpacesService` would have, and the page
 * is handed a synthetic `200`. Nothing else is touched — every URL that is
 * not `mock://` goes to the page's own `fetch` untouched.
 *
 * NOTHING IN THE APP CHANGES FOR THIS. No production code knows the rig
 * exists; a video is not a reason to widen a CSP or to teach a service a
 * second upload path.
 *
 * ARM IT PER FLOW. `flows.mjs` sets `needsSpacesShim: true` on the one
 * flow that uploads a file; the other videos run with a stock `fetch`, so
 * this cannot change what they record.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Where `SpacesService` keeps mock objects. Keep in step with it. */
export const MOCK_ROOT = '/tmp/skydrop-spaces-mock';

/**
 * `mock://<bucket>/<key>?ct=…` → the file on disk.
 *
 * `URL` parses a non-special scheme's authority as the host, so the
 * bucket is `u.host` and the key is the path with its leading slash
 * dropped. Returns null for anything that is not one of ours rather than
 * writing somewhere unexpected.
 */
export function mockObjectPath(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'mock:') return null;
  const bucket = u.host;
  const key = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  if (bucket === '' || key === '') return null;
  // `path.join` RESOLVES `..`, so a key carrying one would escape the
  // root — the same guard SpacesService.mockPath keeps.
  if (key.split('/').includes('..')) return null;
  return path.join(MOCK_ROOT, bucket, key);
}

/** Node side of the binding: write the bytes where the API will look for them. */
async function storeMockObject(rawUrl, base64) {
  const target = mockObjectPath(rawUrl);
  if (target === null) throw new Error(`Refusing to store a non-mock URL: ${rawUrl}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(base64, 'base64'));
  return target;
}

/**
 * Media type for a stored object, from its key and then from its bytes.
 *
 * Nothing on disk records the type — `SpacesService` keeps the bytes and
 * nothing else — so the key's extension is the first answer and the
 * magic number is the fallback. It matters only for the `data:` URL the
 * page is handed, and a wrong type there shows as a broken picture,
 * which is exactly what this exists to prevent.
 */
function mockContentType(key, bytes) {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

/**
 * Node side of the READ binding: hand the page back an object it cannot
 * fetch for itself.
 *
 * Returns null rather than throwing for a missing object. An image the
 * rig cannot find should stay as it was — a broken frame is honest, and
 * an exception here would surface as a page error in the middle of a
 * take.
 */
async function readMockObject(rawUrl) {
  const target = mockObjectPath(rawUrl);
  if (target === null) return null;
  const bytes = await fs.readFile(target).catch(() => null);
  if (bytes === null) return null;
  return {
    contentType: mockContentType(target, bytes),
    base64: bytes.toString('base64'),
  };
}

/**
 * The page-side wrapper, as a string because it is evaluated in the
 * browser and must close over nothing from Node.
 *
 * It is installed as an init script so it survives every navigation, and
 * it captures the ORIGINAL `fetch` once — a second install would
 * otherwise wrap the wrapper.
 */
const PAGE_SHIM = `
(() => {
  if (window.__tutMockFetchInstalled === true) return;
  window.__tutMockFetchInstalled = true;
  const real = window.fetch.bind(window);

  function toBase64(bytes) {
    let s = '';
    // Chunked: String.fromCharCode(...whole file) blows the argument
    // limit on anything bigger than a few hundred KB.
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  async function bodyBytes(body) {
    if (body === undefined || body === null) return new Uint8Array(0);
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return new TextEncoder().encode(String(body));
  }

  window.fetch = async function (input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input && typeof input.url === 'string'
            ? input.url
            : String(input);
    if (!url.startsWith('mock://')) return real(input, init);
    const body = init && init.body !== undefined ? init.body : undefined;
    await window.__tutStoreMockObject(url, toBase64(await bodyBytes(body)));
    // The panel only reads \`ok\`; a 200 with no body is what Spaces
    // answers a successful PUT with.
    return new Response(null, { status: 200, statusText: 'OK' });
  };

  // ── mock:// IMAGES ────────────────────────────────────────────────
  //
  // A GET presign is a \`mock://\` string too, and the app puts it
  // straight into an <img src>. That is NOT a fetch, so the wrapper
  // above cannot help: the browser tries to load an unknown scheme and
  // the frame renders broken. On camera that reads as a failed upload —
  // the one thing a tutorial about uploading must not show.
  //
  // So each one is swapped for a \`data:\` URL of the bytes Node holds.
  // \`img-src\` already admits \`data:\` in the real CSP, so nothing is
  // widened for the rig. The original src is kept on the element, which
  // makes this idempotent: an element already swapped is skipped, and
  // React re-rendering the same src does not start a second read.
  const swapping = new WeakSet();
  async function swapImage(img) {
    const src = img.getAttribute('src');
    if (src === null || !src.startsWith('mock://')) return;
    if (swapping.has(img)) return;
    swapping.add(img);
    try {
      const got = await window.__tutReadMockObject(src);
      if (got === null) return;
      img.dataset.tutMockSrc = src;
      img.src = 'data:' + got.contentType + ';base64,' + got.base64;
    } finally {
      swapping.delete(img);
    }
  }

  function sweep(root) {
    if (root.querySelectorAll === undefined) return;
    for (const img of root.querySelectorAll('img[src^="mock://"]')) void swapImage(img);
  }

  function watch() {
    sweep(document);
    // The upload replaces the <img> rather than mutating it, so a
    // one-shot sweep would catch the placeholder and miss the result.
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target instanceof HTMLImageElement) {
          void swapImage(r.target);
        }
        for (const node of r.addedNodes) {
          if (node instanceof HTMLImageElement) void swapImage(node);
          else if (node instanceof Element) sweep(node);
        }
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watch);
  } else {
    watch();
  }
})();
`;

/**
 * Arm the shim on a browser context.
 *
 * The binding is exposed FIRST: an init script that ran before
 * `__tutStoreMockObject` existed would throw on the first upload, and
 * the failure would look like a broken upload rather than a rig that was
 * wired in the wrong order.
 */
export async function armMockSpaces(context, { onStored } = {}) {
  await context.exposeFunction('__tutStoreMockObject', async (url, base64) => {
    const target = await storeMockObject(url, base64);
    if (typeof onStored === 'function') onStored(target);
    return target;
  });
  await context.exposeFunction('__tutReadMockObject', (url) => readMockObject(url));
  await context.addInitScript(PAGE_SHIM);
}
