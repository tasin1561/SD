import { PutObjectCommand } from '@aws-sdk/client-s3';
import { SpacesService } from '../../src/infrastructure/spaces/spaces.service';
import { makeTestEnv } from '../helpers/env';

/**
 * Every object in the bucket is private.
 *
 * This exists because the whole class of bug was ONE LINE: `putObject`
 * carried `ACL: 'public-read'` unconditionally, so every object it wrote
 * — GST invoices with the buyer's name and address, AWB labels with the
 * recipient's phone, the seller's own CSV error reports — was readable
 * by anyone holding the URL, with no auth and no expiry. Nothing had
 * leaked only because production had not yet generated one.
 *
 * A line that short comes back easily, and it comes back invisibly: the
 * app behaves identically either way, and the objects are only reachable
 * by someone who already has the key. Nothing fails. So the assertion
 * has to be on the COMMAND we hand the SDK, which is the one place the
 * difference is observable without a live bucket.
 */
describe('SpacesService — object visibility', () => {
  /**
   * `recordCommands` swaps the S3 client for a recorder so we can assert
   * on the command we built. The presign tests must NOT do that —
   * presigning is local signing that reaches into the real client's
   * resolved config, and a stub has none of it. No network either way.
   */
  function makeService(recordCommands = true): { svc: SpacesService; sent: unknown[] } {
    const sent: unknown[] = [];
    const svc = new SpacesService(
      makeTestEnv({
        DEV_MOCK_SPACES: false,
        SPACES_ENDPOINT: 'https://sgp1.digitaloceanspaces.com',
        SPACES_REGION: 'sgp1',
        SPACES_BUCKET: 'test-bucket',
        SPACES_ACCESS_KEY_ID: 'key',
        SPACES_SECRET_ACCESS_KEY: 'secret',
      }),
    );
    svc.onModuleInit();
    if (recordCommands) {
      // The service holds the client privately; this is the seam a unit
      // test can reach without a bucket.
      (svc as unknown as { client: { send: (c: unknown) => Promise<unknown> } }).client = {
        send: (cmd: unknown) => {
          sent.push(cmd);
          return Promise.resolve({});
        },
      };
    }
    return { svc, sent };
  }

  it('putObject NEVER sets a public-read ACL', async () => {
    const { svc, sent } = makeService();
    await svc.putObject(
      'invoices/seller-1/SD-INV-2026-000001.pdf',
      Buffer.from('pdf'),
      'application/pdf',
    );

    expect(sent).toHaveLength(1);
    const cmd = sent[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    // The assertion that matters. `undefined` means the bucket default
    // applies, and the bucket is private.
    expect(cmd.input.ACL).toBeUndefined();
  });

  it('putObject sends no ACL for ANY key — not just the sensitive ones', async () => {
    // Guards against a "public for images, private for documents" split
    // creeping back in as a parameter with the wrong default. Reads are
    // presigned per request for every object class; there is no longer a
    // reason for any of them to be world-readable.
    const { svc, sent } = makeService();
    for (const key of [
      'thumbnails/sellers/s1/variants/v1/abc.webp',
      'awb-labels/ship-1/v1-AWB123.pdf',
      'sellers/s1/logo/logo.png',
      'imports/s1/errors.csv',
    ]) {
      await svc.putObject(key, Buffer.from('x'), 'application/octet-stream');
    }
    for (const cmd of sent as PutObjectCommand[]) {
      expect(cmd.input.ACL).toBeUndefined();
    }
  });

  it('canonicalObjectUrl is a pointer, and is NOT what a reader gets', async () => {
    const { svc } = makeService(false);
    const key = 'invoices/seller-1/SD-INV-2026-000001.pdf';

    const pointer = svc.canonicalObjectUrl(key);
    expect(pointer).toBe('https://sgp1.digitaloceanspaces.com/test-bucket/' + key);
    // No credentials in it — which is exactly why it does not resolve.
    expect(pointer).not.toContain('X-Amz-Signature');

    const readable = await svc.presignGetUrl(key, 60);
    expect(readable).toContain('X-Amz-Signature');
    expect(readable).toContain('X-Amz-Expires=60');
  });

  it('a presigned GET carries a bounded lifetime', async () => {
    const { svc } = makeService(false);
    // The default is the one that ships; pin it so a later edit to make
    // a link "less annoying" is a visible decision rather than a typo.
    const url = await svc.presignGetUrl('invoices/s1/x.pdf');
    expect(url).toContain('X-Amz-Expires=900');
  });
});
