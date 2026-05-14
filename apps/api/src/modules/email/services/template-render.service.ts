import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Environment } from 'nunjucks';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { EmailVariables } from '../email.types';

export interface LoadedTemplate {
  id: string;
  code: string;
  language: string;
  version: number;
  subject: string | null;
  bodyTemplate: string;
  htmlBodyTemplate: string | null;
}

export interface RenderedTemplate {
  templateId: string;
  templateCode: string;
  templateVersion: number;
  subject: string | null;
  body: string;
  htmlBody: string | null;
}

@Injectable()
export class TemplateRenderService {
  private readonly logger = new Logger(TemplateRenderService.name);
  /** Escapes interpolated values — used for htmlBodyTemplate. */
  private readonly htmlEnv: Environment;
  /** Does NOT escape — used for plaintext bodies and subjects so URL
   *  ampersands etc. don't get HTML-encoded into the message. */
  private readonly textEnv: Environment;

  constructor(private readonly prisma: PrismaService) {
    this.htmlEnv = new Environment(null, { autoescape: true, throwOnUndefined: false });
    this.textEnv = new Environment(null, { autoescape: false, throwOnUndefined: false });
  }

  /** Loads a template by code+language (defaults to 'en'). */
  async load(code: string, language = 'en'): Promise<LoadedTemplate> {
    const row = await this.prisma.client.notificationTemplate.findUnique({
      where: { code_language: { code, language } },
      select: {
        id: true,
        code: true,
        language: true,
        version: true,
        subject: true,
        bodyTemplate: true,
        htmlBodyTemplate: true,
        isActive: true,
        deletedAt: true,
      },
    });

    if (!row || row.deletedAt || !row.isActive) {
      // Fall back to English if a translation is missing.
      if (language !== 'en') {
        this.logger.warn(
          `Template ${code}/${language} not found or inactive — falling back to 'en'.`,
        );
        return this.load(code, 'en');
      }
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: `Email template not found: ${code}/${language}`,
      });
    }

    return {
      id: row.id,
      code: row.code,
      language: row.language,
      version: row.version,
      subject: row.subject,
      bodyTemplate: row.bodyTemplate,
      htmlBodyTemplate: row.htmlBodyTemplate,
    };
  }

  async render(code: string, variables: EmailVariables = {}, language = 'en'): Promise<RenderedTemplate> {
    const tpl = await this.load(code, language);
    const ctx = normalizeVariables(variables);
    return {
      templateId: tpl.id,
      templateCode: tpl.code,
      templateVersion: tpl.version,
      subject: tpl.subject ? this.renderText(tpl.subject, ctx) : null,
      body: this.renderText(tpl.bodyTemplate, ctx),
      htmlBody: tpl.htmlBodyTemplate ? this.renderHtml(tpl.htmlBodyTemplate, ctx) : null,
    };
  }

  /** Exposed for testing — renders an inline string without DB lookup. */
  renderInline(source: string, variables: EmailVariables = {}, opts: { html?: boolean } = {}): string {
    const ctx = normalizeVariables(variables);
    return opts.html ? this.renderHtml(source, ctx) : this.renderText(source, ctx);
  }

  private renderText(source: string, ctx: Record<string, unknown>): string {
    return this.textEnv.renderString(source, ctx);
  }

  private renderHtml(source: string, ctx: Record<string, unknown>): string {
    return this.htmlEnv.renderString(source, ctx);
  }
}

function normalizeVariables(vars: EmailVariables): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = v === undefined ? null : v;
  }
  return out;
}
