'use client';

import type { ReactElement } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import { Button } from '@skydrop/ui/app/button';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { OoCard } from '../../orders/_components/order-ops-parts';
import './call-center.css';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * The agent's own availability switch.
 *
 * A supervisor could already flip this from the agents screen; the
 * agent themselves could not, which is backwards — the person who knows
 * they are going to lunch is the agent. While marked available they
 * keep being handed orders, and calls assigned to someone who has
 * stepped away sit untouched until their timer expires.
 *
 * Deliberately at the TOP of the station rather than in a settings page
 * nobody opens: it is the thing you change most often and the thing
 * that costs the most when it is wrong.
 */

interface AgentSettings {
  agentId: string;
  maxActiveCalls: number;
  isAvailable: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  timezone: string;
}

function useMySettings(): UseQueryResult<AgentSettings> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['agent-settings', 'me'],
    queryFn: () => client.request<AgentSettings>('/api/agent/settings'),
  });
}

function useSetMyAvailability(): UseMutationResult<AgentSettings, Error, { isAvailable: boolean }> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<AgentSettings>('/api/agent/settings', { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agent-settings'] });
      // A supervisor may be looking at the roster right now.
      void qc.invalidateQueries({ queryKey: ['admin-agents'] });
    },
  });
}

export function MyAvailability(): ReactElement {
  const settings = useMySettings();
  const update = useSetMyAvailability();

  if (settings.isLoading) {
    return (
      <OoCard>
        <Skeleton height={24} width={256} />
      </OoCard>
    );
  }

  // A staff member who is not a call agent has no settings row. That is
  // not an error worth shouting about on the station — just say nothing.
  if (settings.isError || settings.data === undefined) return <></>;

  const available = settings.data.isAvailable;

  return (
    <OoCard>
      <div className="cc-avail">
        <div className="cc-avail__state">
          <StatusChip
            kind={available ? 'delivered' : 'cancelled'}
            label={available ? 'available' : 'not taking calls'}
          />
          <span className="oo-muted">
            {available
              ? 'Orders will be assigned to you.'
              : 'Nothing new will be assigned until you turn this back on.'}
          </span>
        </div>
        <Button
          variant={available ? 'secondary' : 'primary'}
          size="md"
          loading={update.isPending}
          disabled={update.isPending}
          onClick={() => update.mutate({ isAvailable: !available })}
        >
          {update.isPending ? 'Saving…' : available ? 'Stop taking calls' : 'Start taking calls'}
        </Button>
      </div>
      {update.error !== null && (
        <p className="oo-error" role="alert">
          {serverVerdict(update.error)}
        </p>
      )}
    </OoCard>
  );
}
