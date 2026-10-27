/**
 * The unused spreadsheet columns on the order page. What matters is the
 * labelling: a value we recorded and did not act on must never read as
 * honoured, and an order with no extras shows nothing at all.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { OrderCsvExtras } from '@skydrop/api-client';

import { CsvExtrasSection } from '@/app/(authed)/orders/_components/csv-extras';
import { renderWithProviders } from './helpers';

const extras: OrderCsvExtras = {
  v: 1,
  rows: [
    {
      row: 2,
      unused: [
        {
          header: 'Transport Mode',
          value: 'Express',
          reason: 'we choose the courier and the service level, per your courier settings',
        },
      ],
      unrecognised: [{ header: 'Gift Wrap Colour', value: 'Red' }],
    },
    { row: 5, unused: [], unrecognised: [{ header: 'Gift Wrap Colour', value: 'Green' }] },
  ],
};

describe('CsvExtrasSection', () => {
  it('renders nothing for an order placed through the form', () => {
    const { container } = renderWithProviders(<CsvExtrasSection extras={null} />);
    expect(container).toBeEmptyDOMElement();
    const again = renderWithProviders(<CsvExtrasSection extras={{ v: 1, rows: [] }} />);
    expect(again.container).toBeEmptyDOMElement();
  });

  it('is collapsed by default and opens on demand', () => {
    renderWithProviders(<CsvExtrasSection extras={extras} />);
    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('says "not used" with the reason beside a known column, and "not understood" for an unknown one', () => {
    renderWithProviders(<CsvExtrasSection extras={extras} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Transport Mode')).toBeInTheDocument();
    expect(screen.getByText('Express')).toBeInTheDocument();
    expect(screen.getByText('Not used')).toBeInTheDocument();
    expect(
      screen.getByText(/we choose the courier and the service level, per your courier settings/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Not understood')).toHaveLength(2);
    expect(screen.getByText(/did not act on them/)).toBeInTheDocument();
  });

  it('names the file row of each value when the order spans several rows', () => {
    renderWithProviders(<CsvExtrasSection extras={extras} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Row 2 of your file')).toBeInTheDocument();
    expect(screen.getByText('Row 5 of your file')).toBeInTheDocument();
  });
});
