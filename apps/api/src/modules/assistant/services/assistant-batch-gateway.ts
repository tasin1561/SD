import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { EnvService } from '../../../config/env.service';
import type { AssistantUsageTokens } from '../assistant-pricing';

export type MonitorBatchParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

export interface MonitorBatchRequest {
  readonly customId: string;
  readonly params: MonitorBatchParams;
}

export interface MonitorBatchStatus {
  readonly id: string;
  /** `processing_status === 'ended'`. */
  readonly ended: boolean;
  readonly counts: {
    readonly processing: number;
    readonly succeeded: number;
    readonly errored: number;
    readonly canceled: number;
    readonly expired: number;
  };
}

export type MonitorBatchItem =
  | {
      readonly customId: string;
      readonly kind: 'succeeded';
      /** The first text block of the reply (the JSON the schema asked for). */
      readonly text: string;
      readonly model: string;
      readonly usage: AssistantUsageTokens;
    }
  | { readonly customId: string; readonly kind: 'errored' | 'canceled' | 'expired' };

/**
 * The seam between the overnight monitor and the Message Batches API. Only
 * this class knows the SDK, so tests substitute a fake and Anthropic is never
 * reached from a test. Results are normalised to plain data and may arrive in
 * ANY order: callers key them by `customId`.
 */
export abstract class AssistantBatchGateway {
  abstract isConfigured(): boolean;
  abstract createBatch(requests: readonly MonitorBatchRequest[]): Promise<{ id: string }>;
  abstract retrieveBatch(batchId: string): Promise<MonitorBatchStatus>;
  abstract results(batchId: string): Promise<MonitorBatchItem[]>;
}

@Injectable()
export class AnthropicBatchGateway extends AssistantBatchGateway {
  private client: Anthropic | null = null;

  constructor(private readonly env: EnvService) {
    super();
  }

  isConfigured(): boolean {
    return this.env.hasAnthropicApiKey;
  }

  private sdk(): Anthropic {
    // Same key, same lazy construction as `AnthropicModelGateway`.
    this.client ??= new Anthropic({ apiKey: this.env.anthropicApiKey });
    return this.client;
  }

  async createBatch(requests: readonly MonitorBatchRequest[]): Promise<{ id: string }> {
    const batch = await this.sdk().messages.batches.create({
      requests: requests.map((r) => ({ custom_id: r.customId, params: r.params })),
    });
    return { id: batch.id };
  }

  async retrieveBatch(batchId: string): Promise<MonitorBatchStatus> {
    const b = await this.sdk().messages.batches.retrieve(batchId);
    return {
      id: b.id,
      ended: b.processing_status === 'ended',
      counts: {
        processing: b.request_counts.processing,
        succeeded: b.request_counts.succeeded,
        errored: b.request_counts.errored,
        canceled: b.request_counts.canceled,
        expired: b.request_counts.expired,
      },
    };
  }

  async results(batchId: string): Promise<MonitorBatchItem[]> {
    const out: MonitorBatchItem[] = [];
    for await (const item of await this.sdk().messages.batches.results(batchId)) {
      const r = item.result;
      if (r.type !== 'succeeded') {
        out.push({ customId: item.custom_id, kind: r.type });
        continue;
      }
      const text = r.message.content.find((b) => b.type === 'text');
      out.push({
        customId: item.custom_id,
        kind: 'succeeded',
        text: text !== undefined && text.type === 'text' ? text.text : '',
        model: r.message.model,
        usage: {
          inputTokens: r.message.usage.input_tokens,
          outputTokens: r.message.usage.output_tokens,
          cacheReadTokens: r.message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: r.message.usage.cache_creation_input_tokens ?? 0,
        },
      });
    }
    return out;
  }
}
