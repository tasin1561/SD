'use client';

import {
  Building2,
  Hash,
  Mail,
  Package,
  Plane,
  Search,
  Truck,
  User,
  Warehouse,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Checkbox } from '../checkbox';
import { ChoiceCards, type ChoiceCardOption } from '../choice-cards';
import { ComboSelect, type ComboOption } from '../combo-select';
import { DateField } from '../date-field';
import { DropZone } from '../drop-zone';
import { MultiSelect } from '../multi-select';
import { NumberStepper } from '../number-stepper';
import { PasswordField, type PasswordCriterion } from '../password-field';
import { PhoneField } from '../phone-field';
import { SegmentedCode, type SegmentedCodeStatus } from '../segmented-code';
import { Select } from '../select';
import { Switch } from '../switch';
import { TextArea, TextField } from '../text-field';
import type { GalleryEntry } from './types';

/* ── Demo data ─────────────────────────────────────────────────────── */

const WAREHOUSES: readonly ComboOption[] = [
  {
    value: 'blr',
    label: 'Bangalore',
    description: 'Fulfils orders · 3 zones',
    icon: <Warehouse />,
  },
  { value: 'del', label: 'Delhi', description: 'Fulfils orders · 2 zones', icon: <Warehouse /> },
  {
    value: 'dhk',
    label: 'Dhaka intake',
    description: 'Receives from sellers',
    icon: <Building2 />,
  },
  {
    value: 'kol',
    label: 'Kolkata',
    description: 'Opening soon',
    icon: <Warehouse />,
    disabled: true,
  },
];

const STATUSES: readonly ComboOption[] = [
  { value: 'pending', label: 'Pending confirmation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'packed', label: 'Packed' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'rto', label: 'Returning' },
];

const COURIERS: readonly ChoiceCardOption[] = [
  {
    value: 'delhivery',
    title: 'Delhivery',
    description: 'Booked at confirmation, label printed for you.',
    icon: <Truck />,
  },
  {
    value: 'shiprocket',
    title: 'Shiprocket',
    description: 'Picks the carrier by your policy.',
    icon: <Plane />,
  },
  {
    value: 'manual',
    title: 'Manual courier',
    description: 'You type the waybill from the docket.',
    icon: <Package />,
  },
];

const RULES: readonly PasswordCriterion[] = [
  { id: 'len', label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { id: 'num', label: 'A number', test: (v) => /\d/.test(v) },
  { id: 'case', label: 'Upper and lower case', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: 'sym', label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

/* ── Small stateful demos, so every state is live ─────────────────── */

function LiveText(): ReactElement {
  const [v, setV] = useState('');
  return (
    <TextField
      label="Store name"
      icon={<User />}
      hint="Shown to customers on the tracking page."
      maxLength={30}
      showCount
      value={v}
      onChange={(e) => setV(e.target.value)}
      status={v.length >= 3 ? 'valid' : undefined}
    />
  );
}

function LivePhone(): ReactElement {
  const [v, setV] = useState('');
  const [cc, setCc] = useState('+91');
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <PhoneField
        label="Customer phone"
        value={v}
        onChange={(e) => setV(e.target.value)}
        country={cc}
        onCountryChange={setCc}
        hint="Typed exactly as you enter it — nothing is reformatted."
      />
      <span className="sk-figure" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-xs)' }}>
        Parent receives: {cc} “{v}”
      </span>
    </div>
  );
}

function LiveCombo({ error }: { readonly error?: string }): ReactElement {
  const [v, setV] = useState<string | null>(null);
  return (
    <ComboSelect
      label="Warehouse"
      options={WAREHOUSES}
      value={v}
      onChange={(next) => setV(next)}
      hint={error === undefined ? 'Type to filter, ↑ ↓ to move, Enter to choose.' : undefined}
      error={error}
    />
  );
}

function LiveMulti(): ReactElement {
  const [v, setV] = useState<string[]>(['confirmed', 'packed']);
  return (
    <MultiSelect
      label="Order statuses"
      icon={<Search />}
      options={STATUSES}
      value={v}
      onChange={(next) => setV(next)}
      hint="Backspace in the empty box removes the last one."
    />
  );
}

function LiveChoice(): ReactElement {
  const [v, setV] = useState('delhivery');
  return (
    <ChoiceCards label="Default courier" options={COURIERS} value={v} onChange={setV} columns={3} />
  );
}

function LiveCheckbox(): ReactElement {
  const [items, setItems] = useState([true, false, true]);
  const all = items.every(Boolean);
  const some = items.some(Boolean) && !all;
  return (
    <div style={{ display: 'grid' }}>
      <Checkbox
        label="Select all parcels"
        checked={all}
        indeterminate={some}
        onChange={() => setItems(items.map(() => !all))}
      />
      {items.map((on, i) => (
        <div key={i} style={{ paddingLeft: 'var(--sp-6)' }}>
          <Checkbox
            label={`Parcel SH-00${i + 1}`}
            checked={on}
            onChange={() => setItems(items.map((x, k) => (k === i ? !x : x)))}
          />
        </div>
      ))}
    </div>
  );
}

function LiveSwitch(): ReactElement {
  const [on, setOn] = useState(true);
  return (
    <Switch
      label="Auto pickup"
      description={on ? 'A packed box asks for today’s van.' : 'Raise pickups by hand.'}
      checked={on}
      onCheckedChange={setOn}
    />
  );
}

function LiveStepper(): ReactElement {
  const [v, setV] = useState('2');
  return (
    <NumberStepper
      label="Quantity"
      min={1}
      max={10}
      value={v}
      onChange={(e) => setV(e.target.value)}
      hint="1 to 10"
    />
  );
}

function LiveDrop(): ReactElement {
  const [names, setNames] = useState<string[]>([]);
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
      <DropZone
        label="Drop the consignment sheet"
        accept=".csv,.xlsx"
        multiple
        hint="CSV or Excel. Nothing uploads until you save."
        onFiles={(files) => setNames(files.map((f) => f.name))}
      />
      <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-xs)' }}>
        onFiles received: {names.length === 0 ? 'nothing yet' : names.join(', ')}
      </span>
    </div>
  );
}

/** Verifies against a fixed demo code, so success and error are both reachable. */
function LiveCode(): ReactElement {
  const [v, setV] = useState('');
  const [status, setStatus] = useState<SegmentedCodeStatus>('idle');
  return (
    <SegmentedCode
      length={6}
      label="Delivery PIN"
      value={v}
      status={status}
      onChange={(next) => {
        setV(next);
        setStatus('idle');
      }}
      onComplete={(code) => setStatus(code === '560001' ? 'success' : 'error')}
      successText="We deliver here · 2–3 days"
      errorText="We do not deliver to this PIN yet."
      hint="Try 560001 (served) or any other six digits."
    />
  );
}

function StaticCode({
  status,
  value,
}: {
  readonly status: SegmentedCodeStatus;
  readonly value: string;
}): ReactElement {
  const [v, setV] = useState(value);
  return (
    <SegmentedCode
      length={4}
      label="Verification code"
      value={v}
      onChange={setV}
      status={status}
      successText="Code accepted"
      errorText="That code has expired."
    />
  );
}

function LivePassword(): ReactElement {
  const [v, setV] = useState('');
  return (
    <PasswordField
      label="New password"
      icon={<Hash />}
      autoComplete="new-password"
      value={v}
      onChange={(e) => setV(e.target.value)}
      criteria={RULES}
    />
  );
}

/* ── Entries ───────────────────────────────────────────────────────── */

export const FORM_ENTRIES: GalleryEntry[] = [
  {
    id: 'text-field',
    name: 'Text field',
    patterns: ['u33'],
    usedFor: 'Every typed value: names, addresses, references, search.',
    states: [
      {
        label: 'Empty (label rests inside)',
        render: () => <TextField label="Store name" icon={<User />} />,
      },
      { label: 'Live: counter + valid icon', render: () => <LiveText /> },
      {
        label: 'Filled',
        render: () => (
          <TextField label="Email" icon={<Mail />} type="email" defaultValue="ops@skydrop.online" />
        ),
      },
      {
        label: 'With placeholder (label floated)',
        render: () => <TextField label="Order reference" placeholder="e.g. SD-2026-26-000123" />,
      },
      {
        label: 'Error',
        render: () => (
          <TextField
            label="PIN code"
            icon={<Hash />}
            defaultValue="56000"
            error="A PIN code has six digits."
            status="invalid"
          />
        ),
      },
      {
        label: 'Notice',
        render: () => (
          <TextField
            label="PIN code"
            defaultValue="744101"
            notice="We may not deliver to this PIN."
          />
        ),
      },
      { label: 'Required', render: () => <TextField label="Recipient name" required /> },
      {
        label: 'Disabled',
        render: () => <TextField label="Seller" defaultValue="Menev Store" disabled />,
      },
      {
        label: 'Text area',
        render: () => (
          <TextArea
            label="Landmark"
            hint="The field that makes a rural address findable."
            maxLength={120}
            showCount
          />
        ),
      },
      {
        label: 'Text area with error',
        render: () => (
          <TextArea label="Reason" defaultValue="Too short" error="Give at least 20 characters." />
        ),
      },
    ],
  },
  {
    id: 'phone-field',
    name: 'Phone field',
    patterns: ['u02'],
    usedFor: 'Customer and seller phone numbers, India and Bangladesh.',
    states: [
      { label: 'Live (value passes through untouched)', render: () => <LivePhone /> },
      {
        label: 'Bangladesh prefix',
        render: () => <PhoneField label="Seller phone" defaultCountry="+880" />,
      },
      {
        label: 'Error',
        render: () => (
          <PhoneField
            label="Customer phone"
            defaultValue="98765"
            error="An Indian mobile number has ten digits."
          />
        ),
      },
      {
        label: 'Disabled',
        render: () => <PhoneField label="Customer phone" defaultValue="9876543210" disabled />,
      },
    ],
  },
  {
    id: 'select',
    name: 'Select',
    patterns: ['u05'],
    usedFor: 'Short fixed lists where the native picker is best: payment mode, page size.',
    states: [
      {
        label: 'Default',
        render: () => (
          <Select label="Payment mode" icon={<Package />} defaultValue="cod">
            <option value="cod">Cash on delivery</option>
            <option value="prepaid">Prepaid</option>
          </Select>
        ),
      },
      {
        label: 'With hint',
        render: () => (
          <Select label="Rows per page" hint="Applies to this list only." defaultValue="25">
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
        ),
      },
      {
        label: 'Error',
        render: () => (
          <Select label="State" defaultValue="" error="Choose the recipient's state.">
            <option value="">Choose…</option>
            <option value="ka">Karnataka</option>
            <option value="wb">West Bengal</option>
          </Select>
        ),
      },
      {
        label: 'Disabled',
        render: () => (
          <Select label="Currency" defaultValue="inr" disabled>
            <option value="inr">INR</option>
          </Select>
        ),
      },
    ],
  },
  {
    id: 'combo-select',
    name: 'Combo select',
    patterns: ['u05', 'u18'],
    usedFor: 'Longer lists worth filtering: warehouse, seller, SKU.',
    states: [
      { label: 'Live (type to filter)', render: () => <LiveCombo /> },
      {
        label: 'Chosen',
        render: () => <ComboSelect label="Warehouse" options={WAREHOUSES} defaultValue="blr" />,
      },
      { label: 'Error', render: () => <LiveCombo error="Choose where the stock is going." /> },
      {
        label: 'Disabled',
        render: () => (
          <ComboSelect label="Warehouse" options={WAREHOUSES} defaultValue="del" disabled />
        ),
      },
    ],
  },
  {
    id: 'multi-select',
    name: 'Multi select',
    patterns: ['u24'],
    usedFor: 'Filters that take several values: statuses, couriers, stores.',
    states: [
      { label: 'Live with chips', render: () => <LiveMulti /> },
      { label: 'Empty', render: () => <MultiSelect label="Couriers" options={STATUSES} /> },
      {
        label: 'Error',
        render: () => (
          <MultiSelect label="Statuses" options={STATUSES} error="Pick at least one status." />
        ),
      },
      {
        label: 'Disabled',
        render: () => (
          <MultiSelect label="Statuses" options={STATUSES} defaultValue={['delivered']} disabled />
        ),
      },
    ],
  },
  {
    id: 'choice-cards',
    name: 'Choice cards',
    patterns: ['u10'],
    usedFor: 'A few consequential options side by side: courier, freight mode, credit timing.',
    states: [
      { label: 'Live (arrow keys move the choice)', render: () => <LiveChoice /> },
      {
        label: 'Nothing chosen',
        render: () => <ChoiceCards label="Freight mode" options={COURIERS} />,
      },
      {
        label: 'Error',
        render: () => (
          <ChoiceCards
            label="Default courier"
            options={COURIERS}
            error="Choose a courier."
            columns={3}
          />
        ),
      },
      {
        label: 'Disabled',
        render: () => (
          <ChoiceCards label="Default courier" options={COURIERS} defaultValue="manual" disabled />
        ),
      },
    ],
  },
  {
    id: 'checkbox',
    name: 'Checkbox',
    patterns: ['u03'],
    usedFor: 'Row selection, consent, one-off options.',
    states: [
      { label: 'Live with indeterminate parent', render: () => <LiveCheckbox /> },
      {
        label: 'With description',
        render: () => (
          <Checkbox
            label="Email me a daily summary"
            description="Sent at 8 am your time."
            defaultChecked
          />
        ),
      },
      {
        label: 'Error',
        render: () => (
          <Checkbox
            label="I have checked the address"
            error="Confirm before booking the waybill."
          />
        ),
      },
      {
        label: 'Disabled',
        render: () => <Checkbox label="Locked option" defaultChecked disabled />,
      },
    ],
  },
  {
    id: 'switch',
    name: 'Switch',
    patterns: ['u08'],
    usedFor: 'Settings that apply at once: courier intake, auto pickup, notifications.',
    states: [
      { label: 'Live', render: () => <LiveSwitch /> },
      {
        label: 'Off',
        render: () => <Switch label="Live writes" description="Real courier calls." />,
      },
      { label: 'Disabled on', render: () => <Switch label="Stub mode" defaultChecked disabled /> },
    ],
  },
  {
    id: 'number-stepper',
    name: 'Number stepper',
    patterns: ['u12'],
    usedFor: 'Quantities on an order line, counts at receiving.',
    states: [
      { label: 'Live (1 to 10)', render: () => <LiveStepper /> },
      {
        label: 'At the minimum',
        render: () => <NumberStepper label="Boxes" min={1} defaultValue={1} />,
      },
      {
        label: 'Error',
        render: () => (
          <NumberStepper
            label="Units counted"
            min={0}
            defaultValue={12}
            error="More than were sent."
          />
        ),
      },
      {
        label: 'Disabled',
        render: () => <NumberStepper label="Quantity" defaultValue={3} disabled />,
      },
    ],
  },
  {
    id: 'drop-zone',
    name: 'Drop zone',
    patterns: ['u15'],
    usedFor: 'CSV imports, proof of payment, product pictures.',
    states: [
      { label: 'Live (drag a file over, or choose)', render: () => <LiveDrop /> },
      {
        label: 'Error',
        render: () => (
          <DropZone
            label="Proof of transfer"
            onFiles={() => undefined}
            error="Add the bank receipt."
          />
        ),
      },
      {
        label: 'Disabled',
        render: () => <DropZone label="Product pictures" onFiles={() => undefined} disabled />,
      },
    ],
  },
  {
    id: 'date-field',
    name: 'Date field',
    patterns: ['u33'],
    usedFor: 'Report windows, payout dates, expiry dates.',
    states: [
      { label: 'Empty', render: () => <DateField label="Paid on" /> },
      { label: 'Filled', render: () => <DateField label="From" defaultValue="2026-09-01" /> },
      {
        label: 'Date and time',
        render: () => <DateField label="Scanned at" type="datetime-local" />,
      },
      {
        label: 'Error',
        render: () => <DateField label="Closed on" error="Cannot be in the future." />,
      },
      {
        label: 'Disabled',
        render: () => <DateField label="Placed on" defaultValue="2026-08-12" disabled />,
      },
    ],
  },
  {
    id: 'segmented-code',
    name: 'Segmented code',
    patterns: ['10-segmented-code-link-and-merge'],
    usedFor: 'PIN serviceability, one-time codes, confirmation codes.',
    states: [
      { label: 'Live (try 560001)', render: () => <LiveCode /> },
      { label: 'Success', render: () => <StaticCode status="success" value="4821" /> },
      { label: 'Error', render: () => <StaticCode status="error" value="1111" /> },
      {
        label: 'Disabled',
        render: () => (
          <SegmentedCode length={4} label="Verification code" defaultValue="12" disabled />
        ),
      },
    ],
  },
  {
    id: 'password-field',
    name: 'Password field',
    patterns: ['u13'],
    usedFor: 'Sign-in, set a password, reset a password.',
    states: [
      { label: 'Live with criteria', render: () => <LivePassword /> },
      { label: 'Sign-in (no meter)', render: () => <PasswordField label="Password" /> },
      {
        label: 'Error',
        render: () => (
          <PasswordField
            label="Password"
            defaultValue="hunter2"
            error="That password is not right."
          />
        ),
      },
      {
        label: 'Disabled',
        render: () => <PasswordField label="Password" defaultValue="secret" disabled />,
      },
    ],
  },
];
