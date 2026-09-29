/**
 * A label must never rest where an adornment already stands.
 *
 * `TextField`'s `lead` — the seller code on "Full name", the `+91` on a
 * phone, the `₹` on a collectable amount — is laid out at the padding edge,
 * inside the control. The resting label is drawn at the SAME padding edge,
 * absolutely positioned, out of the flex flow it never joined. So on an
 * empty field the two print on top of each other: the owner's screenshot of
 * the New order form shows "Full name" over "MSt" as "FGłt name".
 *
 * The fix is in the primitive (`FieldShell`), not at any call site, so the
 * six leads in the seller's order forms and every future one inherit it. It
 * is pinned HERE rather than a per-field snapshot because the bug is a
 * property of the shell: a field carrying a lead is floated, whatever the
 * lead's width, whatever else the field is doing.
 *
 * `data-float` is the whole contract — the three CSS rules that lift the
 * label, paint the notch behind it and unhide the placeholder are all keyed
 * on it — so asserting the attribute is asserting the layout.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TextField, hasLeadContent } from '@skydrop/ui/app/text-field';

function field(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.sk-field');
  if (!(el instanceof HTMLElement)) throw new Error('no .sk-field rendered');
  return el;
}

const prefix = <span aria-hidden>MSt</span>;

describe('a lead floats the label', () => {
  it('an EMPTY field with a lead is floated — the label does not rest on the prefix', () => {
    const { container } = render(<TextField label="Full name" lead={prefix} value="" />);
    expect(field(container)).toHaveAttribute('data-float');
  });

  it('the same field WITHOUT a lead rests — so the assertion above means something', () => {
    const { container } = render(<TextField label="Full name" value="" />);
    expect(field(container)).not.toHaveAttribute('data-float');
  });

  it('a long lead floats it too — the fix cannot depend on a three-character prefix', () => {
    const { container } = render(
      <TextField label="Full name" lead={<span>Menev Store Kolkata —</span>} value="" />,
    );
    expect(field(container)).toHaveAttribute('data-float');
  });

  it('holds while disabled, in error, and with a leading icon chip', () => {
    for (const props of [
      { disabled: true },
      { error: 'Enter the customer’s name' },
      { icon: <span>@</span> },
    ]) {
      const { container, unmount } = render(
        <TextField label="Full name" lead={prefix} value="" {...props} />,
      );
      expect(field(container)).toHaveAttribute('data-float');
      unmount();
    }
  });

  it('a lead that draws nothing does not float it — an empty fragment is not a prefix', () => {
    // How a caller renders a variable-length adornment: the multi-select
    // passes its chips as one fragment, empty until something is chosen.
    const { container } = render(<TextField label="Tags" lead={<>{[]}</>} value="" />);
    expect(field(container)).not.toHaveAttribute('data-float');
    expect(hasLeadContent(<>{[]}</>)).toBe(false);
    expect(hasLeadContent(<>{prefix}</>)).toBe(true);
    expect(hasLeadContent(undefined)).toBe(false);
    expect(hasLeadContent('')).toBe(false);
  });
});
