import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import { Pagination, ROWS_PER_PAGE, useRowsPerPage } from '@skydrop/ui/app/pagination';

function List({
  user,
  onPage = () => undefined,
}: {
  readonly user: string;
  readonly onPage?: (n: number) => void;
}): ReactElement {
  const [size, setSize] = useRowsPerPage(`seller-orders:${user}`);
  return (
    <LocaleProvider initialLocale="en">
      <output data-testid="size">{size}</output>
      <Pagination
        page={3}
        pageSize={size}
        total={2000}
        pageSizes={ROWS_PER_PAGE}
        onPageChange={onPage}
        onPageSizeChange={(n) => {
          setSize(n);
          onPage(1);
        }}
      />
    </LocaleProvider>
  );
}

beforeEach(() => window.localStorage.clear());

describe('rows per page', () => {
  it('starts at 100 and offers 25, 50, 100, 200 and 500', () => {
    render(<List user="u1" />);
    expect(screen.getByTestId('size')).toHaveTextContent('100');
    const picker = screen.getByLabelText('Rows per page') as HTMLSelectElement;
    expect(picker).toHaveValue('100');
    expect([...picker.options].map((o) => o.value)).toEqual(['25', '50', '100', '200', '500']);
  });

  it('remembers the choice for this person and this list, and goes back to page 1', () => {
    const onPage = vi.fn();
    const first = render(<List user="u1" onPage={onPage} />);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '500' } });
    expect(screen.getByTestId('size')).toHaveTextContent('500');
    expect(onPage).toHaveBeenCalledWith(1);
    expect(window.localStorage.getItem('sd.rows.seller-orders:u1')).toBe('500');
    first.unmount();

    // The same person coming back gets their size…
    const again = render(<List user="u1" />);
    expect(screen.getByTestId('size')).toHaveTextContent('500');
    again.unmount();
    // …someone else on the same browser does not.
    render(<List user="u2" />);
    expect(screen.getByTestId('size')).toHaveTextContent('100');
  });

  it('ignores a stored value that is not one of the sizes', () => {
    window.localStorage.setItem('sd.rows.seller-orders:u1', '9999');
    render(<List user="u1" />);
    expect(screen.getByTestId('size')).toHaveTextContent('100');
  });

  it('still works for the visit when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<List user="u1" />);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    expect(screen.getByTestId('size')).toHaveTextContent('25');
    spy.mockRestore();
  });
});
