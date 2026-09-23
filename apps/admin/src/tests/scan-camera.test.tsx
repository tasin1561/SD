/**
 * Camera scanning — `src/components/barcode-camera.tsx`.
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. The camera is the
 * fallback for a bench with no scan gun: its button only exists where the
 * browser can open a camera, a decoded code goes through the SAME handler
 * the keyboard path uses (so a camera read and a gun read cannot diverge),
 * and the stream is released on every exit. `@zxing/browser` is mocked —
 * the lazy import at :49 resolves to the fake reader below.
 */
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const zxing = vi.hoisted(() => ({
  /** The code the fake reader "sees", or null to decode nothing. */
  code: null as string | null,
  stop: vi.fn(),
  decode: vi.fn(),
}));

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    async decodeFromVideoDevice(
      deviceId: string | undefined,
      video: HTMLVideoElement,
      callback: (
        result: { getText(): string } | undefined,
        err: unknown,
        controls: { stop(): void },
      ) => void,
    ): Promise<{ stop(): void }> {
      zxing.decode(deviceId, video);
      const controls = { stop: zxing.stop };
      const code = zxing.code;
      if (code !== null) callback({ getText: () => code }, undefined, controls);
      return controls;
    }
  },
}));

import { BarcodeCamera, CameraScanButton } from '@/components/barcode-camera';
import { HandoverBench } from '@/app/(authed)/warehouse/handover/_components/handover-bench';
import { makeStaff, renderWithProviders } from './helpers';
import { scanFetch, writesSeen } from './scan-fetch';

const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

function setMediaDevices(value: unknown): void {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true, writable: true });
}

beforeEach(() => {
  zxing.code = null;
  zxing.stop.mockReset();
  zxing.decode.mockReset();
});

afterEach(() => {
  if (original === undefined) {
    // Nothing was there before; leave nothing behind.
    Reflect.deleteProperty(navigator, 'mediaDevices');
  } else {
    Object.defineProperty(navigator, 'mediaDevices', original);
  }
});

describe('CameraScanButton', () => {
  // barcode-camera.tsx:152-165 — no getUserMedia, no button.
  it('renders nothing when navigator.mediaDevices.getUserMedia is absent', () => {
    setMediaDevices(undefined);
    const { container } = render(<CameraScanButton onClick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Scan with the camera' })).not.toBeInTheDocument();
  });

  it('renders nothing when mediaDevices exists without getUserMedia', () => {
    setMediaDevices({});
    const { container } = render(<CameraScanButton onClick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the button when getUserMedia exists', async () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    const onClick = vi.fn();
    render(<CameraScanButton onClick={onClick} />);
    const button = await screen.findByRole('button', { name: 'Scan with the camera' });
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('BarcodeCamera', () => {
  // :54-64 — the first read stops the reader BEFORE handing the code up.
  it('hands a decoded code to onScan once, after stopping the reader', async () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    zxing.code = 'AWB-CAM-1';
    const onScan = vi.fn(() => {
      expect(zxing.stop).toHaveBeenCalled();
    });
    render(<BarcodeCamera open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    expect(onScan).toHaveBeenCalledWith('AWB-CAM-1');
    expect(zxing.decode.mock.calls[0]?.[1]).toBeInstanceOf(HTMLVideoElement);
  });

  // :85-89, :115-117 — closing releases the stream.
  it('stops the stream when the camera is closed', async () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    const user = userEvent.setup();
    // A stable onScan: the effect depends on it, and a new function per
    // render would restart (and stop) the reader for a reason unrelated
    // to closing.
    const onScan = vi.fn();
    function Harness(): ReactElement {
      const [open, setOpen] = useState(true);
      return <BarcodeCamera open={open} onClose={() => setOpen(false)} onScan={onScan} />;
    }
    render(<Harness />);
    await waitFor(() => expect(zxing.decode).toHaveBeenCalledTimes(1));
    // Let the awaited decodeFromVideoDevice resolve and register its stop.
    await act(async () => {
      await Promise.resolve();
    });
    expect(zxing.stop).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close camera' }));
    await waitFor(() => expect(zxing.stop).toHaveBeenCalledTimes(1));
  });

  // :85-89 — unmounting releases it too.
  it('stops the stream on unmount', async () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    const onScan = vi.fn();
    const { unmount } = render(<BarcodeCamera open onClose={vi.fn()} onScan={onScan} />);
    await waitFor(() => expect(zxing.decode).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(zxing.stop).toHaveBeenCalledTimes(1);
  });
});

describe('camera → the keyboard path', () => {
  // handover-bench.tsx:194-200 — a camera read calls the SAME submit() that
  // Enter in #handover-scan calls: identical request, identical body.
  it('a camera read on the handover bench POSTs exactly what a keyboard scan does', async () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    zxing.code = 'AWB-CAM-1';
    const user = userEvent.setup();
    const { fetchImpl } = renderWithProviders(<HandoverBench />, {
      identity: makeStaff(undefined, ['warehouse.dispatch']),
      fetchImpl: scanFetch([
        {
          match: /\/api\/admin\/courier\/handover-scan$/,
          method: 'POST',
          reply: {
            status: 201,
            body: {
              shipmentId: 'sh-1',
              shipmentNumber: 'SH-0001',
              orderId: 'ord-1',
              alreadyScanned: false,
              dispatched: true,
              manifestDispatched: false,
            },
          },
        },
        {
          match: /\/api\/admin\/courier\/handover-queue/,
          method: 'GET',
          reply: { status: 200, body: { waiting: [] } },
        },
        { match: /\/api\/admin\/courier\/scan-block$/, method: 'GET', reply: { status: 200 } },
      ]),
    });
    await user.click(await screen.findByRole('button', { name: 'Scan with the camera' }));
    await screen.findByText('SH-0001');
    expect(writesSeen(fetchImpl)).toEqual([
      { url: '/api/admin/courier/handover-scan', method: 'POST', body: { awbNumber: 'AWB-CAM-1' } },
    ]);
    expect(zxing.stop).toHaveBeenCalled();
  });
});
