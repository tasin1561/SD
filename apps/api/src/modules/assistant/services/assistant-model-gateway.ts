import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { EnvService } from '../../../config/env.service';

export type AssistantModelRequest = Parameters<Anthropic['messages']['stream']>[0];

/**
 * The seam between the assistant and the Anthropic SDK. The chat service
 * only knows this class, so tests substitute a fake and the real API is
 * never reached from a test.
 */
export abstract class AssistantModelGateway {
  /** False when ANTHROPIC_API_KEY is unset: the assistant then says "not configured". */
  abstract isConfigured(): boolean;
  /** Streams one response; `onText` gets each text delta; resolves with the final message. */
  abstract complete(
    req: AssistantModelRequest,
    onText: (delta: string) => void,
  ): Promise<Anthropic.Message>;
}

@Injectable()
export class AnthropicModelGateway extends AssistantModelGateway {
  private client: Anthropic | null = null;

  constructor(private readonly env: EnvService) {
    super();
  }

  isConfigured(): boolean {
    return this.env.hasAnthropicApiKey;
  }

  async complete(
    req: AssistantModelRequest,
    onText: (delta: string) => void,
  ): Promise<Anthropic.Message> {
    // Built on first use, never at boot: an unset key must not stop the API
    // from starting. The key is passed to the SDK and goes nowhere else.
    this.client ??= new Anthropic({ apiKey: this.env.anthropicApiKey });
    const stream = this.client.messages.stream(req);
    stream.on('text', (delta) => onText(delta));
    return stream.finalMessage();
  }
}
