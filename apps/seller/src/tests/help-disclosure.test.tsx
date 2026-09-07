/**
 * Guidance folded behind an (i).
 *
 * Every hint, subtitle and instruction in both apps now reaches the
 * screen through one of four primitives, so the properties worth
 * pinning are the ones that would quietly stop being true for ALL of
 * them at once — and the two that must never be folded, because a
 * warning read after the mistake is not a warning.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardHeader, FormField, Input } from '@skydrop/ui/components';

describe('help disclosure', () => {
  it('a hint is collapsed until the (i) is clicked, and folds back', async () => {
    const user = userEvent.setup();
    render(
      <FormField label="PIN code" hint="Delhivery routes on the PIN.">
        <Input />
      </FormField>,
    );
    const trigger = screen.getByRole('button', { name: /show help for PIN code/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /hide help for PIN code/i })).toBeInTheDocument();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('no hint means NO (i) — a button that opens onto nothing is worse than none', () => {
    render(
      <FormField label="PIN code">
        <Input />
      </FormField>,
    );
    expect(screen.queryByRole('button', { name: /help/i })).not.toBeInTheDocument();
  });

  it('an ERROR is never folded', () => {
    render(
      <FormField label="PIN code" hint="Six digits." error="PIN must be 6 digits.">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('PIN must be 6 digits.')).toBeVisible();
  });

  it('a NOTICE is never folded — it is the thing nobody asked about and needs', () => {
    render(
      <FormField label="PIN code" hint="Six digits." notice="We may not deliver here.">
        <Input />
      </FormField>,
    );
    expect(screen.getByText('We may not deliver here.')).toBeVisible();
    // …and the hint still has its own (i) beside the label.
    expect(screen.getByRole('button', { name: /show help for PIN code/i })).toBeInTheDocument();
  });

  it('the trigger is NOT inside the <label>', () => {
    // A <button> is a labelable element, so a <label> wrapping one stops
    // naming the field and starts naming the button: clicking the label
    // text would toggle the help instead of focusing the input, and the
    // field would reach a screen reader with no name at all.
    render(
      <FormField label="Full name" hint="Your customer's name." htmlFor="fn">
        <Input id="fn" />
      </FormField>,
    );
    const trigger = screen.getByRole('button', { name: /show help for Full name/i });
    expect(trigger.closest('label')).toBeNull();
    expect(screen.getByLabelText(/Full name/i, { selector: 'input' })).toBeInTheDocument();
  });

  it('a card subtitle folds the same way', async () => {
    const user = userEvent.setup();
    render(<CardHeader title="Recipient" subtitle="Where the parcel is going." />);
    const trigger = screen.getByRole('button', { name: /show help for Recipient/i });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
