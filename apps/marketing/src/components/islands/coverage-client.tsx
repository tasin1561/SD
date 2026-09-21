'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { SegmentedCode, type CodeVerdict } from '@/components/micro/segmented-code';
import { CoverageMap } from './coverage-map';
import type { business } from '@/content/site';

type Serviceability = typeof business.serviceability;

/**
 * Direction tabs decide the code's length (6 for an Indian PIN, 4 for a
 * Bangladeshi postcode) and the list it is checked against. The check is
 * LOCAL and instant — a lookup against the business's served ranges — so
 * it links-and-merges rather than parachuting; the card says "Estimated".
 */
export function CoverageClient({
  serviceability,
}: {
  serviceability: Serviceability;
}): ReactElement {
  const [dir, setDir] = useState<'in' | 'bd'>('in');
  const [code, setCode] = useState<string | null>(null);
  // Memoised: SegmentedCode calls `verify` from an effect that lists it as a
  // dependency, so an inline function that also sets state would re-render
  // and re-fire forever. It fires only on a COMPLETE code, which is exactly
  // when the map should light a region.
  const verify = useCallback(
    (code: string): CodeVerdict => {
      setCode(code);
      const first = code[0] ?? '';
      const ok =
        dir === 'in'
          ? serviceability.indiaPinFirstDigits.includes(first)
          : serviceability.bdPostcodeFirstDigits.includes(first);
      if (ok)
        return {
          ok: true,
          detail: `Estimated ${dir === 'in' ? serviceability.transitDaysIndia : serviceability.transitDaysBangladesh} door to door`,
        };
      return { ok: false, detail: 'Not yet — talk to us and we will check with our couriers.' };
    },
    [dir, serviceability],
  );
  useEffect(() => setCode(null), [dir]);
  return (
    <>
      <LiquidBead
        label="Where is the parcel going?"
        className="cov__tabs"
        value={dir}
        onChange={(id) => {
          setDir(id === 'bd' ? 'bd' : 'in');
          setCode(null);
        }}
        tabs={[
          { id: 'in', label: 'Deliver in India', hue: 'saffron' },
          { id: 'bd', label: 'Deliver in Bangladesh', hue: 'green' },
        ]}
      />
      <SegmentedCode
        key={dir}
        length={dir === 'in' ? 6 : 4}
        verify={verify}
        label={dir === 'in' ? 'Indian PIN code' : 'Bangladeshi postcode'}
      />
      <p className="cov__hint">
        {dir === 'in'
          ? 'Six digits, as on an Indian address.'
          : 'Four digits, as on a Bangladeshi address.'}{' '}
        The result is an estimate; the courier confirms at booking.
      </p>
      {/* Desktop only: the 2.5D corridor map under the checker, the checked code's region lit. */}
      <div className="cov__map hidden lg:block">
        <CoverageMap direction={dir} code={code} />
      </div>
    </>
  );
}
