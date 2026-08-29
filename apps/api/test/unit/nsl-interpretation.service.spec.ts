import { NslInterpretationService } from '../../src/modules/tracking-events/services/nsl-interpretation.service';

/**
 * The interpretation a seller reads when a delivery fails.
 *
 * The load-bearing half is ACTIONABILITY — whether Delhivery even
 * accepts a re-attempt on this code — because that is what they
 * publish, and it decides whether the button on the page can do
 * anything. The English gloss is the half they do NOT publish, which is
 * why an unknown code returns null rather than a guess.
 */
describe('NslInterpretationService', () => {
  const svc = new NslInterpretationService();

  it('marks the codes Delhivery accepts a re-attempt on', () => {
    // Their published list, and the same one DelhiveryNdrService
    // enforces before spending a call.
    for (const code of [
      'EOD-74',
      'EOD-15',
      'EOD-104',
      'EOD-43',
      'EOD-86',
      'EOD-11',
      'EOD-69',
      'EOD-6',
    ]) {
      expect(svc.interpret(code)?.reAttemptable).toBe(true);
    }
  });

  it('separates the reschedule codes from the re-attempt ones', () => {
    const qc = svc.interpret('EOD-777');
    expect(qc?.reschedulable).toBe(true);
    expect(qc?.reAttemptable).toBe(false);
    // These two we DO know the meaning of, because our own code
    // already depends on it (CUR-10).
    expect(qc?.plain).toContain('quality check');
  });

  it('returns NULL meaning for a code we do not know, never a guess', () => {
    const unknown = svc.interpret('X-UCI');
    expect(unknown?.code).toBe('X-UCI');
    // Telling a seller their customer refused the parcel when the code
    // meant the office was shut is worse than telling them nothing,
    // because they act on it.
    expect(unknown?.plain).toBeNull();
    expect(unknown?.reAttemptable).toBe(false);
  });

  it('normalises case and whitespace', () => {
    expect(svc.interpret('  eod-74 ')?.reAttemptable).toBe(true);
  });

  it('has nothing to say about no code', () => {
    expect(svc.interpret(null)).toBeNull();
    expect(svc.interpret('   ')).toBeNull();
  });
});
