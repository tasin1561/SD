import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TBody, Table, Td, Tr } from '@skydrop/ui/components';

/**
 * A whole row responds, and the guards that make that safe.
 *
 * ── WHY THE ROW IS CLICKABLE AT ALL ──────────────────────────────────
 * Eight tables used `interactive`, which only paints a pointer cursor.
 * So the row looked clickable everywhere and answered in one cell: you
 * aim at a seller, hit the email column, and nothing happens.
 *
 * ── WHY IT IS NOT THE ONLY WAY IN ────────────────────────────────────
 * A `<tr>` cannot be tabbed to and has no Enter key. The real `<a>` in
 * the primary cell stays, and this is a pointer convenience on top —
 * which is why there is no keyboard test here: there is nothing new to
 * press, deliberately.
 *
 * ── THE TWO GUARDS ARE THE POINT ─────────────────────────────────────
 * Both come from things that would be reported as "it randomly navigates
 * away", and both are easy to lose in a refactor because the happy path
 * keeps working without them.
 */

function Row({ onActivate }: { readonly onActivate: () => void }) {
  return (
    <Table>
      <TBody>
        <Tr onActivate={onActivate}>
          <Td>
            <a href="/somewhere">Menev Store</a>
          </Td>
          <Td>stitasin01@gmail.com</Td>
          <Td>
            <button type="button">Deactivate</button>
          </Td>
        </Tr>
      </TBody>
    </Table>
  );
}

describe('Tr onActivate', () => {
  it('fires when a plain cell is clicked — the whole row, not just the link', async () => {
    const onActivate = vi.fn();
    render(<Row onActivate={onActivate} />);
    await userEvent.click(screen.getByText('stitasin01@gmail.com'));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when a button in the row is clicked', async () => {
    // Otherwise "Deactivate" both opens the confirm AND navigates away
    // from the row it is about.
    const onActivate = vi.fn();
    render(<Row onActivate={onActivate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does NOT fire when the link is clicked — the link is already going there', async () => {
    const onActivate = vi.fn();
    render(<Row onActivate={onActivate} />);
    await userEvent.click(screen.getByRole('link', { name: 'Menev Store' }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does NOT fire when the click ends a text selection', () => {
    // Selecting an email to copy it ends in a click inside the row, with
    // the selection still live. Navigating away mid-copy is maddening
    // and hard to attribute to a cause.
    //
    // Dispatched directly rather than via userEvent: userEvent.click
    // sends a mousedown first, which COLLAPSES the selection before the
    // handler ever runs — so it cannot reproduce a drag-select, and a
    // test written that way would assert nothing while appearing to pass
    // once the guard was deleted. What is under test is the guard
    // reading the selection at click time, which is exactly this.
    const onActivate = vi.fn();
    render(<Row onActivate={onActivate} />);
    const cell = screen.getByText('stitasin01@gmail.com');

    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.isCollapsed).toBe(false);

    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onActivate).not.toHaveBeenCalled();
  });
});
