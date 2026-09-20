import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, for a JSON POST to a regional AWS endpoint.
 *
 * ── WHY THIS IS HAND-ROLLED RATHER THAN `@aws-sdk/client-sesv2` ──────
 * The SDK is the obvious answer and would be a fine one. It is not used
 * here because adding it is a dependency decision that is the owner's to
 * make (MUST NOT #5), and the alternative is genuinely small: SigV4 for
 * a single fixed endpoint is one canonical string, one HMAC chain and
 * one header. The exact call this signs was verified by hand against the
 * live SES account before this was written, so the wire shape is proven
 * rather than assumed.
 *
 * If the SDK is added later, delete this file and the four lines in
 * `SesService` that call it — nothing else in the module knows SigV4
 * exists.
 *
 * Pure: takes a clock so a test can pin the date, touches no network and
 * no config. Every value it signs is passed in.
 */

export interface SigV4Request {
  method: 'POST';
  /** Absolute path, already URL-safe. e.g. `/v2/email/outbound-emails` */
  path: string;
  host: string;
  region: string;
  /** AWS service name, e.g. `ses`. */
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The exact bytes that will be sent — the signature covers them. */
  body: string;
  contentType: string;
  /** Injected so a test can pin the signature. */
  now?: Date;
}

export interface SignedHeaders {
  Authorization: string;
  'X-Amz-Date': string;
  'Content-Type': string;
  Host: string;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';

export function signRequest(req: SigV4Request): SignedHeaders {
  const now = req.now ?? new Date();
  const amzDate = toAmzDate(now); // 20260920T091500Z
  const dateStamp = amzDate.slice(0, 8); // 20260920

  // Signed headers are kept to the three that are always present and
  // always byte-stable. Signing more than is sent, or fewer, is the
  // usual way a hand-rolled SigV4 fails — and it fails as a 403 that
  // says nothing useful.
  const signedHeaderNames = 'content-type;host;x-amz-date';
  const canonicalHeaders =
    `content-type:${req.contentType}\n` + `host:${req.host}\n` + `x-amz-date:${amzDate}\n`;

  const payloadHash = sha256Hex(req.body);

  const canonicalRequest = [
    req.method,
    req.path,
    '', // no query string
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
    '\n',
  );

  const signingKey = deriveSigningKey(req.secretAccessKey, dateStamp, req.region, req.service);
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    Authorization:
      `${ALGORITHM} Credential=${req.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    'X-Amz-Date': amzDate,
    'Content-Type': req.contentType,
    Host: req.host,
  };
}

function deriveSigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp, 'utf8').digest();
  const kRegion = createHmac('sha256', kDate).update(region, 'utf8').digest();
  const kService = createHmac('sha256', kRegion).update(service, 'utf8').digest();
  return createHmac('sha256', kService).update('aws4_request', 'utf8').digest();
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** `20260920T091500Z` — ISO-8601 basic, which is the only form AWS reads. */
export function toAmzDate(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').split('.')[0] ?? ''}Z`;
}
