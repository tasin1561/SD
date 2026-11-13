import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AssistantRecommendationService, githubSettings } from './assistant-recommendation.service';

/**
 * "Create GitHub issue" for a SYSTEM recommendation. It exists only when the
 * server has a GitHub token AND a repository configured
 * (`GITHUB_ISSUES_TOKEN`, `GITHUB_ISSUES_REPO=owner/name`); with neither, the
 * panel hides the button and this answers 404. Nothing creates an issue but
 * a person pressing it, and only once per recommendation.
 */
@Injectable()
export class AssistantGithubIssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recs: AssistantRecommendationService,
  ) {}

  async create(id: string, staffId: string): Promise<{ url: string }> {
    const cfg = githubSettings();
    if (cfg === null) {
      throw new NotFoundException({
        code: 'ASSISTANT_GITHUB_NOT_CONFIGURED',
        message: 'This server has no GitHub token set, so issues cannot be created from here.',
      });
    }
    const task = await this.recs.taskFor(id);
    const row = await this.prisma.client.assistantRecommendation.findUnique({
      where: { id },
      select: { githubIssueUrl: true },
    });
    if (row?.githubIssueUrl != null) {
      throw new ConflictException({
        code: 'ASSISTANT_GITHUB_ISSUE_EXISTS',
        message: 'An issue was already created for this recommendation.',
      });
    }
    // A fixed host and a path built from a validated owner/name: no part of the URL comes from a request.
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'skydrop-assistant-recommendations',
      },
      body: JSON.stringify({ title: task.title.slice(0, 200), body: task.body }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { html_url?: unknown } | null;
    const url = json?.html_url;
    if (!res.ok || typeof url !== 'string' || !url.startsWith('https://github.com/')) {
      throw new BadGatewayException({
        code: 'ASSISTANT_GITHUB_FAILED',
        message: 'GitHub did not accept the issue.',
      });
    }
    await this.recs.recordGithubIssue(id, staffId, url);
    return { url };
  }
}
