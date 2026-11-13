import { groupThemes, pathKey } from '../../src/modules/assistant/assistant-monitor-themes';
import { weeklyFindings } from '../../src/modules/assistant/services/assistant-monitor-digest.service';

describe('monitor themes', () => {
  it('groups the same topic worded slightly differently, counting conversations', () => {
    const t = groupThemes(
      [
        { conversationId: 'a', label: 'cod remittance timing' },
        { conversationId: 'b', label: 'remittance timing for cod' },
        { conversationId: 'c', label: 'cod remittances timing' },
        { conversationId: 'd', label: 'bin transfer' },
        { conversationId: 'a', label: 'cod remittance timing' },
      ],
      'topic',
    );
    expect(t[0]).toMatchObject({ count: 3 });
    expect(t[0]?.conversationIds.sort()).toEqual(['a', 'b', 'c']);
    expect(t[1]).toMatchObject({ label: 'bin transfer', count: 1 });
  });

  it('does not merge unrelated topics', () => {
    const t = groupThemes(
      [
        { conversationId: 'a', label: 'stock adjustment approval' },
        { conversationId: 'b', label: 'freight bill currency' },
      ],
      'topic',
    );
    expect(t).toHaveLength(2);
  });

  it('groups pages by path, ignoring case, query, trailing slash and ids', () => {
    expect(pathKey('/Orders/0191a000-0000-7000-8000-00000000000a/?x=1')).toBe('/orders/:id');
    const t = groupThemes(
      [
        { conversationId: 'a', label: '/orders' },
        { conversationId: 'b', label: '/Orders/' },
        { conversationId: 'c', label: '/warehouse/pack' },
      ],
      'path',
    );
    expect(t[0]).toMatchObject({ count: 2 });
    expect(t).toHaveLength(2);
  });

  it('caps the example conversations', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      conversationId: `c${i}`,
      label: '/orders',
    }));
    const t = groupThemes(items, 'path');
    expect(t[0]?.count).toBe(12);
    expect(t[0]?.conversationIds).toHaveLength(5);
  });
});

describe('weekly report findings', () => {
  const row = (over: Partial<Parameters<typeof weeklyFindings>[0][number]> = {}) => ({
    conversationId: 'c',
    answered: 'YES',
    correctForSkydrop: 'YES',
    userFrustration: 0,
    hallucinationSuspected: false,
    languageMatch: true,
    safetyIssue: 'NONE',
    knowledgeGap: null,
    uiConfusion: null,
    ...over,
  });

  it('puts safety first even when other problems are more common, and keeps at most three', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row({ conversationId: `u${i}`, answered: 'NO' })),
      ...Array.from({ length: 4 }, (_, i) =>
        row({ conversationId: `w${i}`, correctForSkydrop: 'NO' }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        row({ conversationId: `h${i}`, hallucinationSuspected: true }),
      ),
      row({ conversationId: 's', safetyIssue: 'PROMPT_INJECTION' }),
    ];
    const { problems } = weeklyFindings(rows);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^1 conversation flagged for safety/);
  });

  it('recommends the biggest gaps and confusing pages', () => {
    const rows = [
      row({ conversationId: 'a', knowledgeGap: 'cod remittance timing' }),
      row({ conversationId: 'b', knowledgeGap: 'cod remittance timing' }),
      row({ conversationId: 'c', uiConfusion: '/warehouse/pack' }),
    ];
    const { recommendations } = weeklyFindings(rows);
    expect(recommendations[0]).toMatch(/cod remittance timing/);
    expect(recommendations[1]).toMatch(/\/warehouse\/pack/);
  });

  it('says nothing is wrong when nothing is', () => {
    expect(weeklyFindings([row()])).toEqual({ problems: [], recommendations: [] });
  });
});
