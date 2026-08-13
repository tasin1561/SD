'use client';

import { useState, type ReactElement } from 'react';
import { Button, Input } from '@skydrop/ui/components';
import { X } from 'lucide-react';

/**
 * R4 STRICT — the one serial-capture interaction, shared by pick, pack
 * and receiving.
 *
 * A barcode gun is a keyboard that types very fast and presses Enter.
 * So this is one always-focusable field that captures on Enter, a list
 * of what has been captured with a way to take a wrong one back out,
 * and a count. Nothing else: three screens inventing three dialects of
 * the same gesture is how a floor stops trusting any of them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is decide whether the set is
 * acceptable. The count rules belong to the server — exactly `quantity`
 * per line at pick, SET equality against the parcel's picked units at
 * pack, at-most-`receivedQty` at receiving — and a second opinion here
 * could only ever disagree with the first. `required` is a TARGET TO
 * DISPLAY and the caller's own submit gate; the refusal that counts
 * comes back from the API and is shown verbatim.
 *
 * Lives in apps/admin/src/components/ui — no `@/…` imports, so the
 * folder still lifts to @skydrop/ui wholesale when a second app needs
 * it.
 */

export interface SerialScannerProps {
  /** DOM id for the capture field, so a caller can label it. */
  readonly id: string;
  readonly label: string;
  /**
   * How many the server expects, for display and for the caller's
   * submit gate. Omit when the target is not knowable client-side —
   * pack checks the scanned SET against the parcel's picked units, a
   * number this screen cannot compute without re-deriving server logic.
   */
  readonly required?: number;
  readonly serials: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  /** Rendered under the count — why this line is asking at all. */
  readonly hint?: string;
}

/**
 * Whether the caller may submit, by count alone.
 *
 * `allowFewer` is receiving: a supplier who does not serialize is
 * normal, and the server prints Skydrop serials for whatever was not
 * scanned — so a short list must not block intake, while a longer one
 * than arrived is a miscount worth stopping.
 */
export function scanCountMet(
  count: number,
  required: number | undefined,
  allowFewer = false,
): boolean {
  if (required === undefined) return count > 0;
  return allowFewer ? count <= required : count === required;
}

export function SerialScanner({
  id,
  label,
  required,
  serials,
  onChange,
  disabled = false,
  autoFocus = false,
  hint,
}: SerialScannerProps): ReactElement {
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  function capture(raw: string): void {
    const serial = raw.trim();
    setCode('');
    if (serial.length === 0) return;
    // A gun that fires twice on one label is a hardware quirk, not a
    // policy question — de-duplicating the operator's own buffer is not
    // predicting what the server would say about it.
    if (serials.includes(serial)) {
      setNotice(`${serial} is already in this list.`);
      return;
    }
    setNotice(null);
    onChange([...serials, serial]);
  }

  function remove(serial: string): void {
    setNotice(null);
    onChange(serials.filter((s) => s !== serial));
  }

  const over = required !== undefined && serials.length > required;

  return (
    <div className="border-border rounded-[6px] border p-3">
      <label htmlFor={id} className="text-text-muted mb-1 block text-xs">
        {label}
      </label>
      <div className="flex items-start gap-2">
        <Input
          id={id}
          value={code}
          disabled={disabled}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Scan a unit serial…"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              capture(code);
            }
          }}
          className="flex-1 font-mono text-base"
        />
        <div
          className={
            'shrink-0 pt-1.5 text-sm tabular-nums ' + (over ? 'text-critical' : 'text-text-bright')
          }
        >
          {required === undefined ? (
            <span>{serials.length} captured</span>
          ) : (
            <span>
              <span className="font-semibold">{serials.length}</span> / {required}
            </span>
          )}
        </div>
      </div>

      {notice !== null && <div className="text-text-faint mt-1.5 text-xs">{notice}</div>}
      {hint !== undefined && <div className="text-text-faint mt-1.5 text-xs">{hint}</div>}

      {serials.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {serials.map((serial) => (
            <li key={serial}>
              <span className="border-border text-text-body inline-flex items-center gap-0.5 rounded-[4px] border py-0.5 pl-2 font-mono text-xs">
                {serial}
                {/* Button keeps the 44px projected hit area (FE-7) — a
                    wrong serial gets removed with a gloved thumb. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Remove ${serial}`}
                  onClick={() => remove(serial)}
                >
                  <X size={11} />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
