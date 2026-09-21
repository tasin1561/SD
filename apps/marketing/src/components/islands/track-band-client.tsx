'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { PackageSearch } from 'lucide-react';
import { TextField } from '@/components/micro/text-field';
import { RollingLabelButton } from '@/components/micro/rolling-label-button';
import type { AsyncPhase } from '@/components/micro/use-async-state';
import { platform } from '@/content/site';
import { HeroSampleCard } from './hero-action-card';

export function TrackBandClient({ sample }: { sample?: boolean }): ReactElement {
  const [awb, setAwb] = useState('');
  const [phase, setPhase] = useState<AsyncPhase>('idle');
  if (sample) return <HeroSampleCard className="trk__sample" />;
  const go = (e: FormEvent): void => {
    e.preventDefault();
    const v = awb.trim();
    if (!v) return;
    setPhase('busy');
    window.setTimeout(() => {
      window.location.assign(`${platform.nav.track.href}?awb=${encodeURIComponent(v)}`);
    }, 300);
  };
  return (
    <form className="trk__form" onSubmit={go} aria-label="Track a parcel">
      <TextField
        id="track-awb"
        name="awb"
        label="Waybill or order number"
        icon={<PackageSearch size={16} />}
        value={awb}
        onChange={(e) => setAwb(e.currentTarget.value)}
        autoComplete="off"
        inputMode="text"
        required
      />
      <div className="trk__go">
        <RollingLabelButton
          phase={phase}
          icon={<PackageSearch size={16} />}
          labels={{ idle: 'Track', busy: 'Finding…', success: 'Found', error: 'Try again' }}
        />
      </div>
    </form>
  );
}
