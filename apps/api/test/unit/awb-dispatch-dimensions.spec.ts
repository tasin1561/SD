import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Both couriers get the box size.
 *
 * The Shiprocket branch forwarded `lengthCm`/`breadthCm`/`heightCm`; the
 * Delhivery branch silently did not — so a live parcel read
 * `0 x 0 x 0 cm` on Delhivery's own panel while everything upstream was
 * correct: the dispatch input carried the fields, AwbGenerationService
 * filled them with a default when the box was never measured, and
 * DelhiveryAwbService was ready to send them CONDITIONALLY on each being
 * defined. Omitting them one layer up made them undefined, the
 * conditional spread dropped them, and nothing complained.
 *
 * Structural because the failure is a MISSING key in an object literal.
 * A behavioural test only catches it if somebody thought to assert the
 * field — which is the same act of remembering that failed in the first
 * place. Reading both branches and requiring both to mention all three
 * axes cannot be satisfied by forgetting.
 *
 * The names differ on purpose: Delhivery calls the second axis `width`,
 * Shiprocket calls it `breadth`. The dispatcher is where that stops
 * mattering, so the test accepts either spelling per branch.
 */
const FILE = join(
  process.cwd(),
  'src/modules/courier-awb/services/courier-awb-dispatch.service.ts',
);

/** The object literal each branch hands to its adapter. */
function branchBody(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  // Back up to the start of the request literal that precedes the call.
  const from = src.lastIndexOf('const req', at);
  return src.slice(from, at);
}

describe('every courier branch forwards the box size', () => {
  const src = readFileSync(FILE, 'utf8');

  it('Delhivery gets all three axes', () => {
    const body = branchBody(src, 'this.delhivery.generateAwb(');
    expect(body).toMatch(/lengthCm:/);
    expect(body).toMatch(/(widthCm|breadthCm):/);
    expect(body).toMatch(/heightCm:/);
  });

  it('Shiprocket gets all three axes', () => {
    const body = branchBody(src, 'this.shiprocket.generateAwb(');
    expect(body).toMatch(/lengthCm:/);
    expect(body).toMatch(/(widthCm|breadthCm):/);
    expect(body).toMatch(/heightCm:/);
  });

  it('the dispatch input still carries them, so a branch cannot invent its own', () => {
    expect(src).toMatch(/readonly lengthCm: number;/);
    expect(src).toMatch(/readonly breadthCm: number;/);
    expect(src).toMatch(/readonly heightCm: number;/);
  });
});
