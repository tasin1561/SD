'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { ApiError } from '@skydrop/api-client';
import type { CreatedSellerApiKey } from '@skydrop/api-client';
import {
  useApiKeysList,
  useCreateApiKey,
  useRevokeApiKey,
} from '@/lib/api-hooks';

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
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const m = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${m}` : m;
    }
    return e instanceof Error ? e.message : 'Action failed';
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

  return (
    <div className="max-w-4xl space-y-4">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-body text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Settings
      </Link>
      <PageHeader
        title="API keys"
        subtitle="Programmatic access. Plaintext is shown ONCE on create — copy it immediately."
      />

      {revealed && (
        <KeyRevealCard
          created={revealed}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {error && (
        <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
          {error}
        </div>
      )}

      <Card>
        <CardBody>
          <form
            onSubmit={(e) => void onCreate(e)}
            className="grid grid-cols-[1fr_120px_auto] gap-3 items-end"
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
        </CardBody>
      </Card>

      {list.isLoading ? (
        <LoadingState label="Loading keys…" />
      ) : list.isError ? (
        <ErrorState
          message={list.error?.message ?? 'Failed.'}
          retry={() => void list.refetch()}
        />
      ) : !list.data || list.data.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-text-muted text-sm">No API keys yet.</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-text-muted text-[11px] uppercase tracking-wide bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Name</th>
                <th className="text-left px-3 py-2 font-medium">Prefix</th>
                <th className="text-left px-3 py-2 font-medium">Last used</th>
                <th className="text-left px-3 py-2 font-medium">Expires</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((k) => {
                const expired =
                  k.expiresAt !== null &&
                  new Date(k.expiresAt).getTime() < Date.now();
                const revoked = k.revokedAt !== null;
                const status = revoked
                  ? 'REVOKED'
                  : expired
                    ? 'EXPIRED'
                    : 'ACTIVE';
                return (
                  <tr key={k.id} className={revoked || expired ? 'opacity-50' : undefined}>
                    <td className="px-3 py-2 text-text-body">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-text-muted">
                      {k.keyPrefix}…
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-text-muted font-mono text-xs">
                      {k.expiresAt
                        ? new Date(k.expiresAt).toLocaleDateString()
                        : 'No expiry'}
                    </td>
                    <td className="px-3 py-2 text-xs uppercase tracking-wide">
                      <span
                        className={
                          status === 'ACTIVE'
                            ? 'text-accent'
                            : status === 'EXPIRED'
                              ? 'text-pending'
                              : 'text-critical'
                        }
                      >
                        {status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!revoked && !expired && (
                        pendingRevoke === k.id ? (
                          <>
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
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingRevoke(k.id)}
                          >
                            Revoke
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function KeyRevealCard({
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
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="text-accent text-xs uppercase tracking-wide mb-1">
              New API key — copy it now
            </div>
            <div className="text-text-bright text-sm font-medium">
              {created.name}
            </div>
            <p className="text-text-muted text-xs mt-1">
              This is the only time we&apos;ll show the plaintext.{' '}
              {created.expiresAt
                ? `Expires ${new Date(created.expiresAt).toLocaleDateString()}.`
                : 'No expiry set.'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            I&apos;ve copied it
          </Button>
        </div>
        <div className="mt-3 flex items-stretch gap-2">
          <input
            readOnly
            value={created.plaintext}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 px-3 py-1.5 rounded-[5px] bg-bg border border-border text-text-bright text-sm font-mono focus:border-accent focus:outline-none"
          />
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => void copy()}
          >
            <Copy size={12} /> {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
