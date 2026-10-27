import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CsvColumnGuide,
  mandatoryState,
  type CsvColumnGuideColumn,
} from '@skydrop/ui/app/csv-column-guide';

const labels = {
  title: 'Glossary',
  colTitle: 'Title',
  colMandatory: 'Mandatory',
  colDescription: 'Description',
  colSample: 'Sample',
  yes: 'Yes',
  no: 'No',
  notUsed: 'Not used',
  everyRow: 'Every row',
  everyRowHint: 'h1',
  oncePerOrder: 'Once per order',
  oncePerOrderHint: 'h2',
  uat: '(settings)',
};

const columns: CsvColumnGuideColumn[] = [
  {
    field: 'externalRef',
    header: 'Order ID',
    level: 'EVERY_ROW',
    uatControlled: false,
    sample: 'SD-1001',
  },
  {
    field: 'customerPhone',
    header: 'Customer Phone',
    level: 'ONCE_PER_ORDER',
    uatControlled: false,
    sample: '9876543210',
  },
  {
    field: 'codAmount',
    header: 'COD Amount',
    level: 'OPTIONAL',
    uatControlled: false,
    sample: '1500',
  },
  {
    field: 'pickup location',
    header: 'Pickup Location',
    level: 'NOT_USED',
    uatControlled: false,
    sample: 'Skydrop',
    description: 'we choose the warehouse ourselves',
  },
];

describe('CsvColumnGuide glossary', () => {
  it('maps the levels to three states, and NOT_USED is never "No"', () => {
    expect(mandatoryState('EVERY_ROW')).toBe('yes');
    expect(mandatoryState('ONCE_PER_ORDER')).toBe('yes');
    expect(mandatoryState('OPTIONAL')).toBe('no');
    expect(mandatoryState('NOT_USED')).toBe('notUsed');
  });

  it('renders Yes / No / Not used pills, the ignored reason and the sample', () => {
    render(<CsvColumnGuide columns={columns} labels={labels} />);
    const pill = (header: string): string | null | undefined =>
      screen
        .getAllByRole('row')
        .find((r) => r.textContent?.startsWith(header))
        ?.querySelector('[data-state]')?.textContent;
    expect(pill('Order ID')).toBe('Yes');
    expect(pill('COD Amount')).toBe('No');
    expect(pill('Pickup Location')).toBe('Not used');
    expect(screen.getByText('we choose the warehouse ourselves')).toBeTruthy();
    expect(screen.getByText('9876543210')).toBeTruthy();
  });
});
