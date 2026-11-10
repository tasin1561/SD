'use client';

import type { ReactElement } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { useScanSound } from '@/lib/scan-sound';
import { useT } from '@/i18n/client';

/**
 * Mute the scan sounds on THIS device.
 *
 * Several benches in one room all beeping is its own problem, so the sound
 * is mutable — but a muted station has to SAY it is muted, in words and in
 * an icon, or the next packer concludes the feature is broken and nobody
 * ever turns it back on. Hence a labelled button rather than a bare
 * speaker glyph, and `aria-pressed` so the state is readable either way.
 */
export function ScanSoundToggle({ size = 'sm' }: { size?: 'sm' | 'md' }): ReactElement {
  const t = useT();
  const sound = useScanSound();
  return (
    <Button
      type="button"
      variant={sound.muted ? 'secondary' : 'ghost'}
      size={size}
      aria-pressed={sound.muted}
      onClick={sound.toggleMute}
      icon={sound.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      title={sound.muted ? t('scanSound.soundIsOff') : t('scanSound.soundIsOn')}
    >
      {sound.muted ? t('scanSound.soundOff') : t('scanSound.soundOn')}
    </Button>
  );
}
