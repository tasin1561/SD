import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwbCopy, AwbTitle } from '@skydrop/ui/app/awb-copy';

afterEach(() => {
  vi.useRealTimers();
});

describe('AwbCopy', () => {
  it('copies the AWB, says Copied for 2s, and does not trigger the row around it', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <AwbCopy awb="38061100001" />
      </div>,
    );
    expect(screen.getByText('38061100001')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy AWB 38061100001/ }));
    });
    expect(writeText).toHaveBeenCalledWith('38061100001');
    expect(rowClick).not.toHaveBeenCalled();
    expect(screen.getByText('Copied')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('shows each AWB of a split order once, and nothing for null', () => {
    const { container, rerender } = render(<AwbCopy awb={['A1', 'B2', 'A1']} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    rerender(<AwbCopy awb={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AwbTitle', () => {
  it('reads "AWB <number>" with a copy button once an AWB exists, one per parcel', () => {
    render(<AwbTitle awbs={['38061110634966', null, '38061110634977']} />);
    expect(screen.getByText('38061110634966')).toBeInTheDocument();
    expect(screen.getByText('38061110634977')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(document.body.textContent).toMatch(/^AWB /);
  });

  it('reads exactly "AWB ___________________" with no button before any AWB', () => {
    const { container } = render(<AwbTitle awbs={[null]} />);
    expect(container.textContent).toContain('AWB ___________________');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('copies an order number under its own label', () => {
    render(<AwbCopy awb="ORD-12" kind="order" />);
    expect(screen.getByRole('button', { name: 'Copy order number ORD-12' })).toBeInTheDocument();
  });
});
