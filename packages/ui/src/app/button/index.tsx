import { clsx } from 'clsx';
import { LoaderCircle } from 'lucide-react';
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import './button.css';

/**
 * Button (u28 sweep). The app's one button.
 *
 *   primary      accent fill; on hover/focus a gradient sweeps in from the
 *                left (a pseudo-element on transform), the right icon steps
 *                right, a soft accent glow lifts it
 *   secondary    surface card with a control border; a pale accent sweep
 *   ghost        no chrome until hover
 *   destructive  red fill, red sweep — deletes, cancels, suspends
 *
 * Sizes sm 32 / md 40 / lg 44 px; a `sm` button still answers a full
 * `--tap` hit area (an invisible ::after), so dense tables stay tappable.
 *
 * `loading` swaps the leading icon for a spinner, sets `aria-busy` and
 * disables the button; the label and so the accessible name never change.
 * A wired-to-a-promise label change is `AsyncButton`, not this.
 *
 * The sweep lives in its own clipped layer (`__fx`) rather than clipping
 * the button, because clipping the button would also clip the hit area.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonLook {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonLook & {
    loading?: boolean | undefined;
    fullWidth?: boolean | undefined;
  };

export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  ButtonLook & {
    fullWidth?: boolean | undefined;
  };

/** The class list, for a caller that must put the look on its own element. */
export function buttonClassName(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  fullWidth = false,
  className?: string,
): string {
  return clsx(
    'sk-btn',
    `sk-btn--${variant}`,
    `sk-btn--${size}`,
    fullWidth && 'sk-btn--full',
    className,
  );
}

function ButtonInner({
  icon,
  iconRight,
  loading,
  children,
}: {
  icon: ReactNode;
  iconRight: ReactNode;
  loading: boolean;
  children: ReactNode;
}): ReactElement {
  const lead = loading ? <LoaderCircle size={16} className="sk-btn__spin" /> : icon;
  return (
    <>
      <span className="sk-btn__fx" aria-hidden />
      {lead ? (
        <span className="sk-btn__icon" aria-hidden>
          {lead}
        </span>
      ) : null}
      {children !== undefined && children !== null && children !== false ? (
        <span className="sk-btn__label">{children}</span>
      ) : null}
      {iconRight ? (
        <span className="sk-btn__icon sk-btn__icon--right" aria-hidden>
          {iconRight}
        </span>
      ) : null}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    fullWidth = false,
    className,
    disabled,
    type = 'button',
    children,
    ...rest
  },
  ref,
): ReactElement {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName(variant, size, fullWidth, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      <ButtonInner icon={icon} iconRight={iconRight} loading={loading}>
        {children}
      </ButtonInner>
    </button>
  );
});

/**
 * The same look on an `<a>`. Navigation is never delayed: hover and press
 * feedback only. Wrap a Next `<Link>` by passing its props through, or use
 * `buttonClassName()` on the Link itself.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    fullWidth = false,
    className,
    children,
    ...rest
  },
  ref,
): ReactElement {
  return (
    <a ref={ref} className={buttonClassName(variant, size, fullWidth, className)} {...rest}>
      <ButtonInner icon={icon} iconRight={iconRight} loading={false}>
        {children}
      </ButtonInner>
    </a>
  );
});
