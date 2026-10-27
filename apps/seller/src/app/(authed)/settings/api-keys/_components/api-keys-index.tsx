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
import { Checkbox } from '@skydrop/ui/app/checkbox';
import {
  SELLER_API_KEY_SCOPES,
  type CreatedSellerApiKey,
  type SellerApiKeyScope,
} from '@skydrop/api-client';
import { useApiKeysList, useCreateApiKey, useRevokeApiKey } from '@/lib/api-hooks';
import { verdict } from '@/i18n/verdict';
import { RevealCard, SetCallout, SetFact, SetPageHeader } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('settingsApiKeys.clientConsole') },
  { label: t('settingsApiKeys.account') },
  { label: t('settingsApiKeys.settings'), href: '/settings' },
  { label: t('settingsApiKeys.apiKeys') },
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
  const t = useT();
  const list = useApiKeysList();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const toast = useToast();
  const [name, setName] = useState('');
  const [ttlDays, setTtlDays] = useState('');
  const [scopes, setScopes] = useState<readonly SellerApiKeyScope[]>([]);
  const [revealed, setRevealed] = useState<CreatedSellerApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<{
    readonly id: string;
    readonly name: string;
    readonly prefix: string;
  } | null>(null);

  function fmtError(e: unknown): string {
    return verdict(e, t, t('settingsApiKeys.actionFailed'));
  }

  function toggleScope(scope: SellerApiKeyScope, on: boolean): void {
    setScopes((prev) => (on ? [...prev, scope] : prev.filter((s) => s !== scope)));
  }

  function onCreate(e: FormEvent): void {
    e.preventDefault();
    setError(null);
    // Cosmetic, per FE-2 — the server refuses an empty list too. Saying
    // it here stops somebody minting a key that fails on first use with
    // a message about a field they never saw.
    if (scopes.length === 0) {
      setError(t('settingsApiKeys.chooseAtLeastOne'));
      return;
    }
    setConfirmCreate(true);
  }

  async function doCreate(): Promise<void> {
    setError(null);
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        scopes,
        ...(ttlDays ? { expiresInDays: Number(ttlDays) } : {}),
      });
      setRevealed(res);
      setName('');
      setTtlDays('');
      setScopes([]);
      toast.success(t('settingsApiKeys.apiKeyCreated'));
    } catch (e) {
      setError(fmtError(e));
    }
  }

  async function onRevoke(id: string): Promise<void> {
    setError(null);
    try {
      await revoke.mutateAsync({ id });
      toast.success(t('settingsApiKeys.apiKeyRevoked'));
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
        crumbs={crumbsOf(t)}
        title={t('settingsApiKeys.apiKeys')}
        subtitle={t('settingsApiKeys.programmaticAccessPlaintextIs')}
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
          title={t('settingsApiKeys.newApiKeyCopy')}
          note={revealed.name}
          body={
            <>
              {t('settingsApiKeys.thisIsTheOnly')}{' '}
              {revealed.expiresAt !== null
                ? t('settingsApiKeys.expires', {
                    expiresAt: new Date(revealed.expiresAt).toLocaleDateString(),
                  })
                : t('settingsApiKeys.noExpirySet')}
            </>
          }
          value={revealed.plaintext}
          valueLabel={t('settingsApiKeys.apiKeyPlaintext')}
          dismissLabel={t('settingsApiKeys.iVeCopiedIt')}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {error && (
        <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading
          title={t('settingsApiKeys.issueAKey')}
          note={t('settingsApiKeys.thePlaintextIsShown')}
        />
        <div className="set-card">
          <form onSubmit={onCreate} className="set-inline">
            <TextField
              label={t('settingsApiKeys.keyName')}
              icon={<Tag size={15} />}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              showCount
              required
              placeholder={t('settingsApiKeys.eGProductionCrm')}
              className="set-grow"
            />
            <TextField
              label={t('settingsApiKeys.expiresInDays')}
              icon={<CalendarClock size={15} />}
              hint={t('settingsApiKeys.blankNoExpiry')}
              type="number"
              min={1}
              max={730}
              value={ttlDays}
              onChange={(e) => setTtlDays(e.target.value)}
              inputClassName="sk-figure"
              className="set-narrow"
            />
            {/*
              What the key may do. Ticked boxes rather than a role, because
              a key belongs to the COMPANY and there is no person behind it
              to read a role off — and because a key that can do everything
              is exactly what this replaced.
            */}
            <fieldset className="set-scopes">
              <legend>{t('settingsApiKeys.whatMayThisKey')}</legend>
              <p className="set-muted">{t('settingsApiKeys.pickAsLittleAs')}</p>
              <div className="set-scopes__list">
                {SELLER_API_KEY_SCOPES.map((scope) => (
                  <Checkbox
                    key={scope.key}
                    label={scope.label}
                    description={scope.description}
                    checked={scopes.includes(scope.key)}
                    onChange={(e) => toggleScope(scope.key, e.target.checked)}
                  />
                ))}
              </div>
            </fieldset>
            <div className="set-buttons" data-align="start">
              <AsyncButton
                type="submit"
                variant="primary"
                icon={<KeyRound size={15} />}
                labels={{
                  idle: t('settingsApiKeys.createKey'),
                  busy: t('settingsApiKeys.creating'),
                  error: t('settingsApiKeys.notCreated'),
                }}
                state={create.isPending ? 'busy' : 'idle'}
                disabled={create.isPending}
              />
            </div>
          </form>
        </div>
      </section>

      <section className="set-section">
        <SectionHeading
          title={t('settingsApiKeys.yourKeys')}
          note={rows.length === 0 ? undefined : t('settingsApiKeys.issued', { rows: rows.length })}
        />
        <div className="set-card" data-flush>
          {list.isLoading ? (
            <SkeletonRows rows={3} cols={6} label={t('settingsApiKeys.loadingKeys')} />
          ) : list.isError ? (
            <ErrorState
              message={list.error?.message ?? t('settingsApiKeys.failed')}
              retry={() => void list.refetch()}
            />
          ) : (
            <Table caption={t('settingsApiKeys.apiKeys')}>
              <THead>
                <Tr>
                  <Th>{t('settingsApiKeys.name')}</Th>
                  <Th>{t('settingsApiKeys.prefix')}</Th>
                  <Th>{t('settingsApiKeys.scopes')}</Th>
                  <Th>{t('settingsApiKeys.lastUsed')}</Th>
                  <Th>{t('settingsApiKeys.expires2')}</Th>
                  <Th>{t('settingsApiKeys.state')}</Th>
                  <Th align="right">{t('settingsApiKeys.actions')}</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.length === 0 ? (
                  <TableEmpty colSpan={7}>{t('settingsApiKeys.noApiKeysYet')}</TableEmpty>
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
                          {k.scopes.length === 0
                            ? t('settingsApiKeys.noneReissueThisKey')
                            : k.scopes.join(', ')}
                        </Td>
                        <Td className="set-cell-muted">
                          {k.lastUsedAt !== null ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                        </Td>
                        <Td className="set-cell-muted">
                          {k.expiresAt !== null
                            ? new Date(k.expiresAt).toLocaleDateString()
                            : t('settingsApiKeys.noExpiry')}
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
                              {t('settingsApiKeys.revoke')}
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
        title={t('settingsApiKeys.createThisApiKey')}
        entity={name.trim()}
        consequence={t(
          ttlDays
            ? ttlDays === '1'
              ? 'settingsApiKeys.createConsequenceOneDay'
              : 'settingsApiKeys.createConsequenceDays'
            : 'settingsApiKeys.createConsequenceNever',
          { scopes: scopes.join(', '), ttlDays },
        )}
        confirmLabel={t('settingsApiKeys.createKey')}
        onConfirm={doCreate}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setPendingRevoke(null);
        }}
        title={t('settingsApiKeys.revokeThisApiKey')}
        entity={pendingRevoke === null ? '' : `${pendingRevoke.name} · ${pendingRevoke.prefix}…`}
        consequence={t('settingsApiKeys.everyIntegrationUsingThis')}
        confirmLabel={t('settingsApiKeys.revokeKey')}
        destructive
        onConfirm={() => (pendingRevoke === null ? undefined : onRevoke(pendingRevoke.id))}
      />
    </div>
  );
}
