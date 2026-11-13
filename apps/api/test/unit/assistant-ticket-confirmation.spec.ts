import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssistantTicketService,
  ticketPermissionFor,
} from '../../src/modules/assistant/services/assistant-ticket.service';
import type { ProposalRow } from '../../src/modules/assistant/services/assistant-store.service';
import type { CallerScope } from '../../src/modules/assistant/assistant.types';
import { scope, storeScope, staffScope, USER_A, USER_B } from '../helpers/assistant-fixtures';

/**
 * A proposal becomes a ticket ONLY when its owner presses the button, and
 * then exactly once.
 *
 * The store below applies the SAME guarded transitions the real one does
 * (owner columns + status in the `where`), one await at a time, so two
 * `confirm` calls racing each other behave as two UPDATEs racing in Postgres
 * (the real-database version of this is `assistant-ticket-proposals.e2e-spec`).
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

class MemoryProposals {
  rows = new Map<string, Mutable<ProposalRow> & { audience: string; ownerUserId: string }>();
  add(over: Partial<ProposalRow> = {}, owner: CallerScope = scope()): ProposalRow {
    const row = {
      id: '0191a000-0000-7000-8000-0000000000aa',
      conversationId: 'c1',
      subject: 'Parcel stuck',
      description: 'It has not moved in four days.',
      orderId: 'order-1',
      orderNumber: 'SD-1',
      status: 'PENDING' as const,
      ticketId: null,
      ticketNumber: null,
      requestId: null,
      createdAt: new Date(),
      decidedAt: null,
      audience: owner.audience,
      ownerUserId: owner.userId,
      ...over,
    };
    this.rows.set(row.id, row);
    return row;
  }
  private mine(s: CallerScope, id: string) {
    const r = this.rows.get(id);
    return r && r.audience === s.audience && r.ownerUserId === s.userId ? r : null;
  }
  async findOwnedProposal(s: CallerScope, id: string) {
    const r = this.mine(s, id);
    return r ? { ...r } : null;
  }
  async claimProposal(s: CallerScope, id: string) {
    const r = this.mine(s, id);
    if (!r || r.status !== 'PENDING') return false;
    r.status = 'CONFIRMED';
    return true;
  }
  async releaseProposal(s: CallerScope, id: string) {
    const r = this.mine(s, id);
    if (r && r.status === 'CONFIRMED' && r.ticketId === null && r.requestId === null) {
      r.status = 'PENDING';
    }
  }
  async recordProposalOutcome(
    id: string,
    o: { ticketId: string | null; ticketNumber: string | null; requestId: string | null },
  ) {
    const r = this.rows.get(id);
    if (r && r.status === 'CONFIRMED' && r.ticketId === null && r.requestId === null) {
      Object.assign(r, o);
    }
  }
  async dismissProposal(s: CallerScope, id: string) {
    const r = this.mine(s, id);
    if (!r || r.status !== 'PENDING') return false;
    r.status = 'DISMISSED';
    return true;
  }
}

function rig(opts: { openFails?: boolean; delayMs?: number } = {}) {
  const store = new MemoryProposals();
  let opened = 0;
  const tickets = {
    open: jest.fn(async () => {
      opened += 1;
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.openFails) {
        throw new UnprocessableEntityException({
          code: 'ORDER_NOT_FOUND',
          message: 'No such order.',
        });
      }
      return { id: `ticket-${opened}`, ticketNumber: `TK-2026-00000${opened}` };
    }),
  };
  const storeIssues = {
    raise: jest.fn(async () => ({
      applied: true as const,
      ticket: { id: 'store-ticket-1', ticketNumber: 'TK-2026-000100' },
      request: null,
    })),
  };
  const escalation = { escalate: jest.fn(async () => undefined) };
  const svc = new AssistantTicketService(
    store as never,
    tickets as never,
    storeIssues as never,
    escalation as never,
  );
  return { store, tickets, storeIssues, escalation, svc };
}

const SELLER = scope({ permissions: ['tickets.create'] });

describe('confirming a ticket proposal', () => {
  it('raises the ticket through the existing service, as the caller, and records it', async () => {
    const { store, svc, tickets, escalation } = rig();
    const p = store.add();
    const out = await svc.confirm(SELLER, p.id);
    expect(out).toMatchObject({ status: 'CONFIRMED', ticketNumber: 'TK-2026-000001', held: false });
    expect(tickets.open).toHaveBeenCalledTimes(1);
    const [input, actor] = tickets.open.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(input).toMatchObject({
      ticketType: 'SELLER_RAISED_ISSUE',
      sellerId: SELLER.sellerId,
      subject: 'Parcel stuck',
      orderId: 'order-1',
    });
    expect(actor).toMatchObject({ type: 'SELLER', sellerUserId: SELLER.userId });
    expect(escalation.escalate).toHaveBeenCalledTimes(1);
  });

  it('two clicks, ten tabs and a replay raise ONE ticket', async () => {
    const { store, svc, tickets } = rig({ delayMs: 15 });
    const p = store.add();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => svc.confirm(SELLER, p.id)),
    );
    expect(tickets.open).toHaveBeenCalledTimes(1);
    // The losers either get the winner's result or a 409 — never a second ticket.
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const replay = await svc.confirm(SELLER, p.id);
    expect(replay.ticketId).toBe('ticket-1');
    expect(tickets.open).toHaveBeenCalledTimes(1);
  });

  it('is a 404 for anyone but the owner, and raises nothing', async () => {
    const { store, svc, tickets } = rig();
    const p = store.add();
    const other = scope({ userId: USER_B, permissions: ['tickets.create'] });
    await expect(svc.confirm(other, p.id)).rejects.toBeInstanceOf(NotFoundException);
    // Same user id in another audience is a different person.
    await expect(
      svc.confirm(
        scope({ audience: 'ASSOCIATE', userId: USER_A, permissions: ['tickets.manage'] }),
        p.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tickets.open).not.toHaveBeenCalled();
    expect(store.rows.get(p.id)?.status).toBe('PENDING');
  });

  it('re-checks the permission at confirm time: without it, 403, still PENDING, nothing raised', async () => {
    const { store, svc, tickets } = rig();
    const p = store.add();
    await expect(svc.confirm(scope({ permissions: ['orders.view'] }), p.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tickets.open).not.toHaveBeenCalled();
    expect(store.rows.get(p.id)?.status).toBe('PENDING');
  });

  it('staff are never offered this: a 404', async () => {
    const { store, svc } = rig();
    const p = store.add({}, staffScope());
    await expect(
      svc.confirm(staffScope({ permissions: ['tickets.create'] }), p.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ticketPermissionFor('STAFF')).toBeNull();
  });

  it('puts the proposal back to PENDING when the ticket service throws, and passes its error through', async () => {
    const { store, svc } = rig({ openFails: true });
    const p = store.add();
    await expect(svc.confirm(SELLER, p.id)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_FOUND', message: 'No such order.' },
    });
    expect(store.rows.get(p.id)).toMatchObject({ status: 'PENDING', ticketId: null });
    // ...and the person can press it again.
    const second = rig();
    second.store.rows = store.rows;
    const ok = await second.svc.confirm(SELLER, p.id);
    expect(ok.status).toBe('CONFIRMED');
  });

  it('never reopens a proposal that already produced a ticket, even if writing the outcome failed', async () => {
    const { store, svc, tickets } = rig();
    const p = store.add();
    store.recordProposalOutcome = async () => {
      throw new Error('db down');
    };
    const out = await svc.confirm(SELLER, p.id);
    expect(out.status).toBe('CONFIRMED');
    expect(store.rows.get(p.id)?.status).toBe('CONFIRMED');
    await expect(svc.confirm(SELLER, p.id)).rejects.toBeInstanceOf(ConflictException);
    expect(tickets.open).toHaveBeenCalledTimes(1);
  });

  it('a dismissed proposal cannot be confirmed (409), and dismissing twice is fine', async () => {
    const { store, svc, tickets } = rig();
    const p = store.add();
    expect((await svc.dismiss(SELLER, p.id)).status).toBe('DISMISSED');
    expect((await svc.dismiss(SELLER, p.id)).status).toBe('DISMISSED');
    await expect(svc.confirm(SELLER, p.id)).rejects.toBeInstanceOf(ConflictException);
    expect(tickets.open).not.toHaveBeenCalled();
  });

  it('a raised ticket cannot be dismissed', async () => {
    const { store, svc } = rig();
    const p = store.add();
    await svc.confirm(SELLER, p.id);
    await expect(svc.dismiss(SELLER, p.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('a member store goes through the store issue service (policy gate), and a held issue is reported as held', async () => {
    const owner = storeScope({ permissions: ['tickets.manage'], orderScope: 'ALL' });
    const { store, svc, storeIssues, tickets } = rig();
    const p = store.add({}, owner);
    const out = await svc.confirm(owner, p.id);
    expect(out.ticketNumber).toBe('TK-2026-000100');
    expect(tickets.open).not.toHaveBeenCalled();
    expect(storeIssues.raise).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: owner.storeId, orderId: 'order-1', orderScope: 'ALL' }),
    );

    storeIssues.raise.mockResolvedValueOnce({
      applied: false as never,
      ticket: null as never,
      request: { id: 'req-1' } as never,
    } as never);
    const q = store.add({ id: '0191a000-0000-7000-8000-0000000000ab' }, owner);
    const held = await svc.confirm(owner, q.id);
    expect(held).toMatchObject({ held: true, ticketId: null, status: 'CONFIRMED' });
  });

  it('an associate without tickets.manage cannot confirm', async () => {
    const assoc = storeScope({
      audience: 'ASSOCIATE',
      orderScope: 'OWN',
      permissions: ['orders.view'],
    });
    const { store, svc } = rig();
    const p = store.add({}, assoc);
    await expect(svc.confirm(assoc, p.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('nothing the model can call raises a ticket (structural)', () => {
  const dir = join(__dirname, '../../src/modules/assistant');
  const sources = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === 'generated'
          ? []
          : sources(join(d, e.name))
        : e.name.endsWith('.ts')
          ? [join(d, e.name)]
          : [],
    );
  const code = (f: string): string =>
    readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('only the ticket service and the human controllers import the ticket modules', () => {
    const importers = sources(dir)
      .filter((f) => /ticket\/services|courier-escalation|AssistantTicketService/.test(code(f)))
      .map((f) => f.slice(dir.length))
      .sort();
    expect(importers).toEqual(
      [
        '/assistant.module.ts',
        '/controllers/seller-assistant.controller.ts',
        '/controllers/store-assistant.controller.ts',
        '/services/assistant-ticket.service.ts',
      ].sort(),
    );
  });

  it('the tool layer (tools, registry, chat) cannot reach the ticket service', () => {
    for (const f of [
      'tools/assistant-tools.ts',
      'services/assistant-tool-registry.service.ts',
      'services/assistant-chat.service.ts',
      'services/assistant-help.service.ts',
    ]) {
      const src = code(join(dir, f));
      expect(src).not.toMatch(
        /TicketService|StoreIssueService|assistant-ticket\.service|escalat|\.confirm\(|\.open\(|openStoreIssue/,
      );
    }
  });

  it('the confirm route is a human HTTP POST that checks the caller, never a tool', () => {
    for (const f of [
      'controllers/seller-assistant.controller.ts',
      'controllers/store-assistant.controller.ts',
    ]) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).toMatch(/@Post\('ticket-proposals\/:id\/confirm'\)/);
      expect(src).toMatch(/ticketProposals\.confirm\(scopeFrom\w+\(/);
    }
    // staff have no raise-a-ticket flow, so their console has no confirm route
    expect(
      readFileSync(join(dir, 'controllers/admin-assistant.controller.ts'), 'utf8'),
    ).not.toMatch(/ticket-proposals/);
  });

  it('the only tool that stores anything is propose_ticket, and it stores a proposal', () => {
    const src = code(join(dir, 'tools/assistant-tools.ts'));
    const stores = [...src.matchAll(/deps\.proposals\.(\w+)/g)].map((m) => m[1]);
    expect(stores).toEqual(['createProposal']);
  });
});
