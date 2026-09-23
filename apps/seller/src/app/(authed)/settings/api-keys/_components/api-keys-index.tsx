'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { CalendarClock, CircleAlert, KeyRound, Tag } from 'lucide-react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, THead, Td, Th, Tr, TableEmpty } from '@skydrop/ui/app/data-table';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import type { CreatedSellerApiKey } from '@skydrop/api-client';
import { useApiKeysList, useCreateApiKey, useRevokeApiKey } from '@/lib/api-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { RevealCard, SetCallout, SetFact, SetPageHeader } from '../../_components/settings-parts';

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

/**
 * API keys. Creating one and revoking one both ask first: a new key is a
 * credential that works the moment it exists, and a revoked one stops
 * every integration using it at once. The confirmation restates the key
 * and sends exactly the request the form (or the row) used to send.
 */
export function ApiKeysIndex(): ReactElement {
  const list = useApiKeysList();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const toast = useToast();
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState('');
  const [revealed, setRevealed] = useState<CreatedSellerApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<{
    readonly id: string;
    readonly name: string;
    readonly prefix: string;
  } | null>(null);

  function fmtError(e: unknown): string {
    return serverVerdict(e, 'Action failed');
  }

  function onCreate(e: FormEvent): void {
    e.preventDefault();
    setError(null);
    setConfirmCreate(true);
  }

  async function doCreate(): Promise<void> {
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
    <div className="set-page">
      <SetPageHeader
        crumbs={CRUMBS}
        title="API keys"
        subtitle="Programmatic access. Plaintext is shown ONCE on create — copy it immediately."
        /*
          The comps put a request count and a rate-limit headroom bar
          here. Neither is stored per key — `lastUsedAt` is the whole
          usage record — so these facts say what the register knows.
        */
        meta={
          list.data === undefined ? undefined : (
            <span className="set-meta">
              <SetFact tone="accent">
                {rows.length} {rows.length === 1 ? 'key' : 'keys'}
              </SetFact>
              <SetFact tone={active.length === 0 ? undefined : 'good'} dot>
                {active.length} active
              </SetFact>
            </span>
          )
        }
      />

      {revealed && (
        <RevealCard
          icon={<KeyRound size={15} />}
          title="New API key — copy it now"
          note={revealed.name}
          body={
            <>
              This is the only time we&apos;ll show the plaintext.{' '}
              {revealed.expiresAt !== null
                ? `Expires ${new Date(revealed.expiresAt).toLocaleDateString()}.`
                : 'No expiry set.'}
            </>
          }
          value={revealed.plaintext}
          valueLabel="API key plaintext"
          dismissLabel="I've copied it"
          onDismiss={() => setRevealed(null)}
        />
      )}

      {error && (
        <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading title="Issue a key" note="The plaintext is shown once." />
        <div className="set-card">
          <form onSubmit={onCreate} className="set-inline">
            <TextField
              label="Key name"
              icon={<Tag size={15} />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              showCount
              required
              placeholder="e.g. Production CRM"
              className="set-grow"
            />
            <TextField
              label="Expires in days"
              icon={<CalendarClock size={15} />}
              hint="Blank = no expiry"
              type="number"
              min={1}
              max={730}
              value={ttlDays}
              onChange={(e) => setTtlDays(e.target.value)}
              inputClassName="sk-figure"
              className="set-narrow"
            />
            <div className="set-buttons" data-align="start">
              <AsyncButton
                type="submit"
                variant="primary"
                icon={<KeyRound size={15} />}
                labels={{ idle: 'Create key', busy: 'Creating…', error: 'Not created' }}
                state={create.isPending ? 'busy' : 'idle'}
                disabled={create.isPending}
              />
            </div>
          </form>
        </div>
      </section>

      <section className="set-section">
        <SectionHeading
          title="Your keys"
          note={rows.length === 0 ? undefined : `${rows.length} issued`}
        />
        <div className="set-card" data-flush>
          {list.isLoading ? (
            <SkeletonRows rows={3} cols={6} label="Loading keys…" />
          ) : list.isError ? (
            <ErrorState
              message={list.error?.message ?? 'Failed.'}
              retry={() => void list.refetch()}
            />
          ) : (
            <Table caption="API keys">
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
                      <Tr key={k.id} data-dead={dead ? '1' : undefined}>
                        <Td className="set-cell-strong">{k.name}</Td>
                        <Td>
                          <span className="sk-ident">{k.keyPrefix}…</span>
                        </Td>
                        <Td className="set-cell-muted">
                          {k.lastUsedAt !== null ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                        </Td>
                        <Td className="set-cell-muted">
                          {k.expiresAt !== null
                            ? new Date(k.expiresAt).toLocaleDateString()
                            : 'No expiry'}
                        </Td>
                        <Td>
                          <StatusChip
                            kind={stateKind(state)}
                            label={state.charAt(0) + state.slice(1).toLowerCase()}
                            size="sm"
                          />
                        </Td>
                        <Td align="right">
                          {!dead && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setPendingRevoke({ id: k.id, name: k.name, prefix: k.keyPrefix })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmCreate}
        onOpenChange={setConfirmCreate}
        title="Create this API key?"
        entity={name.trim()}
        consequence={`A new key that can call the seller API for this company the moment it exists. ${
          ttlDays
            ? `It expires in ${ttlDays} ${ttlDays === '1' ? 'day' : 'days'}.`
            : 'It never expires.'
        } The plaintext is shown once, straight after — copy it then.`}
        confirmLabel="Create key"
        onConfirm={doCreate}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title="Revoke this API key?"
        entity={pendingRevoke === null ? '' : `${pendingRevoke.name} · ${pendingRevoke.prefix}…`}
        consequence="Every integration using this key stops working at once. A revoked key cannot be brought back — you would issue a new one."
        confirmLabel="Revoke key"
        destructive
        onConfirm={() => (pendingRevoke === null ? undefined : onRevoke(pendingRevoke.id))}
      />
    </div>
  );
}
