'use client';

import { Calendar } from 'lucide-react';
import { forwardRef, type ReactElement } from 'react';
import { TextField, type TextFieldProps } from '../text-field';
import './date-field.css';

/**
 * DateField. A styled NATIVE date input (`date`, `datetime-local`, `time`
 * or `month`), so the phone's own picker and a test's `fireEvent.change`
 * both keep working and the value stays the browser's ISO string. The
 * label is always floated because the native control always draws its own
 * placeholder ("dd/mm/yyyy"). A calendar icon chip leads unless `icon` is
 * given (or `icon={null}`).
 */
export type DateFieldProps = Omit<TextFieldProps, 'type' | 'floatLabel' | 'showCount'> & {
  readonly type?: 'date' | 'datetime-local' | 'time' | 'month' | undefined;
};

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { type = 'date', icon, variant, ...rest },
  ref,
): ReactElement {
  return (
    <TextField
      ref={ref}
      type={type}
      icon={icon === undefined ? <Calendar /> : icon}
      floatLabel
      variant={variant ? `sk-date ${variant}` : 'sk-date'}
      {...rest}
    />
  );
});
