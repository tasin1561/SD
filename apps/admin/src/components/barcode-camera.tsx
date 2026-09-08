'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Camera, X } from 'lucide-react';
import { Button, Modal } from '@skydrop/ui/components';

/**
 * Read a barcode with the device camera.
 *
 * ── WHY IT IS OPTIONAL, NOT THE DEFAULT ──────────────────────────────
 * A USB scan gun is faster, works one-handed, and does not need
 * daylight — so the text field stays the primary input and this is the
 * fallback for a phone on the bench, or a gun that has run out of
 * battery mid-parcel. The button only appears where a camera exists.
 *
 * ── THE LIBRARY IS LAZY-LOADED ───────────────────────────────────────
 * `@zxing/browser` is ~250KB and every page that never scans should pay
 * nothing for it, so it is imported inside the effect rather than at
 * module scope. That also keeps it out of the server bundle, where
 * `navigator` does not exist.
 *
 * ── IT STOPS THE CAMERA ON EVERY EXIT ────────────────────────────────
 * Closing, unmounting, a successful read, or an error all release the
 * stream. A camera left running is a light on somebody's phone and a
 * warehouse tablet that goes flat by lunchtime.
 */
export function BarcodeCamera({
  open,
  onClose,
  onScan,
  title = 'Scan with the camera',
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
}): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const video = videoRef.current;
        if (video === null || cancelled) return;

        const controls = await reader.decodeFromVideoDevice(
          undefined,
          video,
          (result, _err, ctrl) => {
            if (result === null || result === undefined) return;
            // Stop BEFORE handing the code up: the caller may close the
            // modal, and a reader still decoding into a torn-down video
            // element throws in the console for no reason.
            ctrl.stop();
            stopRef.current = null;
            onScan(result.getText());
          },
        );
        stopRef.current = () => controls.stop();
        if (cancelled) controls.stop();
      } catch (err) {
        /*
          SAY WHICH. "Check the permission" is the wrong instruction on a
          desktop with no camera at all, and somebody will go and check
          it — the failures below need different actions and reported as
          one they get the same wrong one.

          `getUserMedia` names them: NotAllowedError is a refusal,
          NotFoundError is a machine without a camera, NotReadableError
          is another app already holding it, and an absent
          `mediaDevices` is a page that is not a secure context.
        */
        if (!cancelled) setError(cameraFailure(err));
      }
    })();

    return (): void => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [open, onScan]);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
    >
      <div className="space-y-3">
        {error === null ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              className="bg-surface-hover aspect-video w-full rounded"
              playsInline
              muted
            />
            <p className="text-text-muted text-xs">
              Hold the barcode steady in the frame. It reads automatically.
            </p>
          </>
        ) : (
          <p className="text-status-failed-fg text-sm">{error}</p>
        )}
        <Button variant="ghost" onClick={onClose}>
          <X size={14} /> Close camera
        </Button>
      </div>
    </Modal>
  );
}

/** What actually went wrong, and what to do about it. */
function cameraFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const tail = ' You can type or scan the code into the field instead.';
  if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
    return 'This page is not served over https, so the browser will not give it a camera.' + tail;
  }
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return (
        'The browser blocked the camera. Allow it for this site from the icon in the address bar, ' +
        'then try again.' +
        tail
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera on this machine — nothing to open.' + tail;
    case 'NotReadableError':
    case 'AbortError':
      return 'Another app is already using the camera. Close it and try again.' + tail;
    default:
      return 'The camera could not be opened.' + tail;
  }
}

/** The button that opens it — hidden where there is no camera at all. */
export function CameraScanButton({ onClick }: { onClick: () => void }): ReactElement | null {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined,
    );
  }, []);
  if (!supported) return null;
  return (
    <Button variant="ghost" onClick={onClick} aria-label="Scan with the camera">
      <Camera size={14} /> Camera
    </Button>
  );
}
