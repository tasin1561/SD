/**
 * SerialScanner — the one serial-capture field shared by pick, pack and
 * receiving (`src/components/ui/serial-scanner.tsx`).
 *
 * PINS CURRENT BEHAVIOUR AHEAD OF THE APPS RESTYLE. A barcode gun is a
 * keyboard that types fast and presses Enter; every assertion here is
 * about what that Enter does, what the count says and how a wrong serial
 * comes back out. A restyle must not loosen any of it — if one of these
 * fails after a visual change, the change altered behaviour.
 */
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SerialScanner, scanCountMet } from '@/components/ui/serial-scanner';

function Harness({
  required,
  initial = [],
  onChange,
}: {
  readonly required?: number;
  readonly initial?: readonly string[];
  readonly onChange?: (next: readonly string[]) => void;
}): ReactElement {
  const [serials, setSerials] = useState<readonly string[]>(initial);
  return (
    <SerialScanner
      id="serials"
      label="Unit serials"
      {...(required === undefined ? {} : { required })}
      serials={serials}
      onChange={(next) => {
        onChange?.(next);
        setSerials(next);
      }}
    />
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText('Unit serials') as HTMLInputElement;
}

describe('SerialScanner — Enter captures', () => {
  // serial-scanner.tsx:115-120 — Enter calls preventDefault (a scanner's
  // Enter inside a form must not submit it) and captures.
  it('prevents the default action of Enter', () => {
    render(<Harness required={2} />);
    fireEvent.change(field(), { target: { value: 'SER-1' } });
    const ev = createEvent.keyDown(field(), { key: 'Enter' });
    fireEvent(field(), ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  // :79-92 — trims, appends, clears the field.
  it('trims the scanned value, appends it and clears the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness required={2} onChange={onChange} />);
    await user.type(field(), '  SER-1  {Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['SER-1']);
    expect(field().value).toBe('');
    expect(screen.getByRole('button', { name: 'Remove SER-1' })).toBeInTheDocument();
  });

  // :82 — an empty (or whitespace-only) scan is ignored.
  it('ignores an empty or whitespace-only scan', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness required={2} onChange={onChange} />);
    await user.type(field(), '{Enter}');
    await user.type(field(), '   {Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe('');
  });

  // Typing without Enter captures nothing — only Enter commits.
  it('captures nothing until Enter is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness required={2} onChange={onChange} />);
    await user.type(field(), 'SER-1');
    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe('SER-1');
  });

  // :86-88 — a duplicate is not appended, and says so in exactly these words.
  it('de-duplicates with the exact notice text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness required={3} onChange={onChange} />);
    await user.type(field(), 'SER-1{Enter}');
    await user.type(field(), 'SER-1{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText('SER-1 is already in this list.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove SER-1' })).toHaveLength(1);
    // The next good capture clears the notice (:90).
    await user.type(field(), 'SER-2{Enter}');
    expect(screen.queryByText('SER-1 is already in this list.')).not.toBeInTheDocument();
  });
});

describe('SerialScanner — the count', () => {
  // :128-134 — "n / required" when there is a target.
  it('shows n / required', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness required={2} />);
    expect(container.textContent).toContain('0 / 2');
    await user.type(field(), 'SER-1{Enter}');
    expect(container.textContent).toContain('1 / 2');
  });

  // :129 — "n captured" when there is no target (the pack finish step).
  it('shows "n captured" with no target', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('0 captured')).toBeInTheDocument();
    await user.type(field(), 'SER-1{Enter}');
    expect(screen.getByText('1 captured')).toBeInTheDocument();
  });

  // :99, :123-126 — over the target, the count turns critical. The
  // component exposes NO role, aria attribute or text for this state; the
  // `text-critical` class on the count's wrapper is the only signal, so it
  // is pinned here. A restyle that renames the token must keep an
  // over-count signal and update this assertion deliberately.
  it('turns the count critical when over the target, and only then', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness required={1} />);
    const count = (): HTMLElement => {
      // The INNERMOST div reading "n / 1": its wrapper row reads the same
      // (the input beside it has no text), so the first match is the row.
      const el = Array.from(container.querySelectorAll('div'))
        .filter((d) => /^\d+ \/ 1$/.test(d.textContent ?? ''))
        .pop();
      if (el === undefined) throw new Error('count not found');
      return el;
    };
    await user.type(field(), 'SER-1{Enter}');
    expect(count().className).not.toContain('text-critical');
    await user.type(field(), 'SER-2{Enter}');
    expect(count().textContent).toBe('2 / 1');
    expect(count().className).toContain('text-critical');
  });
});

describe('SerialScanner — taking one back out', () => {
  // :149-157 — each chip's remove button is named "Remove {serial}".
  it('removes exactly the serial named by the button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness required={3} initial={['SER-1', 'SER-2']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove SER-1' }));
    expect(onChange).toHaveBeenLastCalledWith(['SER-2']);
    expect(screen.queryByRole('button', { name: 'Remove SER-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove SER-2' })).toBeInTheDocument();
  });
});

describe('scanCountMet', () => {
  // :57-64 — exact count by default.
  it('requires the exact count', () => {
    expect(scanCountMet(2, 2)).toBe(true);
    expect(scanCountMet(1, 2)).toBe(false);
    expect(scanCountMet(3, 2)).toBe(false);
  });

  // allowFewer is receiving: fewer is fine, more is a miscount.
  it('allowFewer accepts fewer but never more', () => {
    expect(scanCountMet(0, 2, true)).toBe(true);
    expect(scanCountMet(2, 2, true)).toBe(true);
    expect(scanCountMet(3, 2, true)).toBe(false);
  });

  // No target ⇒ at least one.
  it('with no target, needs at least one', () => {
    expect(scanCountMet(0, undefined)).toBe(false);
    expect(scanCountMet(1, undefined)).toBe(true);
  });
});
