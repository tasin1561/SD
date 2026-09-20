'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { Copy, KeyRound } from 'lucide-react';
import {
  BandBody,
  Button,
  Crumbs,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  MetaChip,
  PageHeader,
  SectionBand,
  StatusBadge,
  TBody,
  THead,
  Table,
  TableEmpty,
  Td,
  Th,
  Tr,
  useToast,
} from '@skydrop/ui/components';
import type { CreatedSellerApiKey } from '@skydrop/api-client';
import { useApiKeysList, useCreateApiKey, useRevokeApiKey } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Settings', href: '/settings' },
  { label: 'API keys' },
];

/** ACTIVE / EXPIRED / REVOKED, decided the same way in both places it is read. */
type KeyState = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

function keyState(key: {
  readonly revokedAt: string | null;
  readonly expiresAt: string | null;
}): KeyState {
  if (key.revokedAt !== null) return 'REVOKED';
  if (key.expiresAt !== null && new Date(key.expiresAt).getTime() < Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

/**
 * A revoked key and an expired one are both dead, and they are NOT the
 * same fact: one was taken away, the other ran out. `cancelled` and
 * `pending` are the two kinds that say so without inventing a colour.
 */
function stateKind(state: KeyState): 'delivered' | 'pending' | 'cancelled' {
  switch (state) {
    case 'ACTIVE':
      return 'delivered';
    case 'EXPIRED':
      return 'pending';
    case 'REVOKED':
      return 'cancelled';
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function ApiKeysIndex(): ReactElement {
  const list = useApiKeysList();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const toast = useToast();
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState('');
  const [revealed, setRevealed] = useState<CreatedSellerApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  async function onCreate(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        ...(ttlDays ? { expiresInDays: Number(ttlDays) } : {}),
      });
      setRevealed(res);
      setName('');
      setTtlDays('');
      toast.success('API key created.');
    } catch (e) {
      setError(fmtError(e));
    }
  }

  async function onRevoke(id: string): Promise<void> {
    setError(null);
    try {
      await revoke.mutateAsync({ id });
      toast.success('API key revoked.');
      setPendingRevoke(null);
    } catch (e) {
      setError(fmtError(e));
    }
  }

  const rows = list.data ?? [];
  const active = rows.filter((k) => keyState(k) === 'ACTIVE');

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Crumbs items={CRUMBS} Link={Link} />}
        title="API keys"
        subtitle="Programmatic access. Plaintext is shown ONCE on create — copy it immediately."
        /*
          The comps put a request count and a rate-limit headroom bar
          here. Neither is stored per key — `lastUsedAt` is the whole
          usage record — so these chips say what the register knows.
        */
        meta={
          list.data === undefined ? undefined : (
            <>
              <MetaChip tone="accent">
                {rows.length} {rows.length === 1 ? 'key' : 'keys'}
              </MetaChip>
              <MetaChip tone={active.length === 0 ? 'neutral' : 'good'} dot>
                {active.length} active
              </MetaChip>
            </>
          )
        }
      />

      {revealed && <KeyRevealPanel created={revealed} onDismiss={() => setRevealed(null)} />}

      {error && (
        <div className="text-critical border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] rounded-[var(--radius-2)] border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <div>
        <SectionBand index="01" title="Issue a key" note="The plaintext is shown once." />
        <BandBody>
          <form
            onSubmit={(e) => void onCreate(e)}
            className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_140px_auto]"
          >
            <FormField label="Key name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                required
                placeholder="e.g. Production CRM"
              />
            </FormField>
            <FormField label="Expires in days" hint="Blank = no expiry">
              <Input
                type="number"
                min={1}
                max={730}
                value={ttlDays}
                onChange={(e) => setTtlDays(e.target.value)}
              />
            </FormField>
            <Button type="submit" variant="primary" size="md" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </form>
        </BandBody>
      </div>

      <div>
        <SectionBand
          index="02"
          title="Key register"
          note={rows.length === 0 ? undefined : `${rows.length} issued`}
        />
        <BandBody flush>
          {list.isLoading ? (
            <div className="p-3">
              <LoadingState label="Loading keys…" />
            </div>
          ) : list.isError ? (
            <div className="p-3">
              <ErrorState
                message={list.error?.message ?? 'Failed.'}
                retry={() => void list.refetch()}
              />
            </div>
          ) : (
            <Table wrapperClassName="rounded-none border-0 bg-transparent">
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Prefix</Th>
                  <Th>Last used</Th>
                  <Th>Expires</Th>
                  <Th>State</Th>
                  <Th align="right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={6}>No API keys yet.</TableEmpty>
                ) : (
                  rows.map((k) => {
                    const state = keyState(k);
                    const dead = state !== 'ACTIVE';
                    return (
                      <Tr key={k.id} className={dead ? 'opacity-60' : undefined}>
                        <Td className="text-text-bright">{k.name}</Td>
                        <Td className="text-text-muted font-mono text-xs">{k.keyPrefix}…</Td>
                        <Td className="text-text-muted font-mono text-xs">
                          {k.lastUsedAt !== null ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                        </Td>
                        <Td className="text-text-muted font-mono text-xs">
                          {k.expiresAt !== null
                            ? new Date(k.expiresAt).toLocaleDateString()
                            : 'No expiry'}
                        </Td>
                        <Td>
                          <StatusBadge
                            kind={stateKind(state)}
                            label={state.charAt(0) + state.slice(1).toLowerCase()}
                          />
                        </Td>
                        <Td align="right">
                          {!dead &&
                            (pendingRevoke === k.id ? (
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => void onRevoke(k.id)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPendingRevoke(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPendingRevoke(k.id)}
                              >
                                Revoke
                              </Button>
                            ))}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </TBody>
            </Table>
          )}
        </BandBody>
      </div>
    </div>
  );
}

function KeyRevealPanel({
  created,
  onDismiss,
}: {
  readonly created: CreatedSellerApiKey;
  readonly onDismiss: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(created.plaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      /* clipboard may fail in insecure context */
    }
  }

  return (
    <div>
      <SectionBand
        title={
          <span className="inline-flex items-center gap-1.5">
            <KeyRound size={12} aria-hidden /> New API key — copy it now
          </span>
        }
        note={created.name}
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            I&apos;ve copied it
          </Button>
        }
      />
      <BandBody>
        <p className="text-text-muted text-xs leading-relaxed">
          This is the only time we&apos;ll show the plaintext.{' '}
          {created.expiresAt !== null
            ? `Expires ${new Date(created.expiresAt).toLocaleDateString()}.`
            : 'No expiry set.'}
        </p>
        <div className="mt-3 flex items-stretch gap-2">
          <Input
            readOnly
            aria-label="API key plaintext"
            value={created.plaintext}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 font-mono"
          />
          <Button type="button" variant="primary" size="md" onClick={() => void copy()}>
            <Copy size={12} aria-hidden /> {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </BandBody>
    </div>
  );
}
