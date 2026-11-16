import {
  DelhiveryWhatsappPage,
  bubbleHashes,
  parseSentAt,
  parseWhatsappModalText,
} from '../../src/modules/courier-portal/pages/delhivery-whatsapp.page';

/**
 * Decisions only: a fake Playwright page drives "button present / absent /
 * modal unreadable". Whether the selectors match Delhivery's real DOM can
 * only be proven against the live panel — flagged as pending.
 */
const MODAL = [
  'Whatsapp',
  'Out for delivery: your parcel arrives today, please call 07949341300 to reach the delivery executive',
  '12:45 PM',
  'You refused delivery of your shipment',
  '03:10 PM',
  'Okay',
].join('\n');

function fakePage(opts: {
  awbOnScreen?: boolean;
  button?: boolean;
  dialog?: boolean;
  modalText?: string;
}) {
  const log = { clicks: [] as string[], escape: 0 };
  const yes = async (): Promise<void> => undefined;
  const no = async (): Promise<void> => {
    throw new Error('timeout');
  };
  const node = (name: string, present: boolean, text = ''): unknown => {
    const n: Record<string, unknown> = {
      first: () => n,
      or: () => n,
      waitFor: present ? yes : no,
      innerText: async () => text,
      click: async () => {
        if (!present) throw new Error('timeout');
        log.clicks.push(name);
      },
      fill: yes,
      press: yes,
      getByRole: (_r: string, o: { name: RegExp }) =>
        node(`modal:${o.name.source}`, opts.dialog !== false),
    };
    return n;
  };
  const page = {
    goto: yes,
    url: () => 'https://one.delhivery.com/',
    waitForLoadState: yes,
    waitForTimeout: yes,
    keyboard: {
      press: async () => {
        log.escape += 1;
      },
    },
    getByPlaceholder: () => node('search', false),
    getByText: () => node('awb', opts.awbOnScreen !== false),
    getByRole: (role: string) => {
      if (role === 'dialog') {
        return node('dialog', opts.dialog !== false, opts.modalText ?? MODAL);
      }
      return node('view-whatsapp', opts.button !== false, 'View Whatsapp');
    },
  };
  return { page: page as never, log };
}

describe('parseWhatsappModalText', () => {
  it('reads text + time pairs and drops the window chrome', () => {
    const r = parseWhatsappModalText(MODAL);
    expect(r).toHaveLength(2);
    expect(r?.[0]?.sentLabel).toBe('12:45 PM');
    expect(r?.[1]?.text).toBe('You refused delivery of your shipment');
  });

  it('carries a date heading into the label', () => {
    const r = parseWhatsappModalText('Whatsapp\n14 Nov 2026\nHello\n09:05 AM\nOkay');
    expect(r?.[0]?.sentLabel).toBe('14 Nov 2026, 09:05 AM');
  });

  it('is null on any doubt: no pairs, a time with no text, text with no time', () => {
    expect(parseWhatsappModalText('Whatsapp\nOkay')).toBeNull();
    expect(parseWhatsappModalText('Whatsapp\n12:45 PM\nHello')).toBeNull();
    expect(parseWhatsappModalText('Whatsapp\nHello\n12:45 PM\nstray words')).toBeNull();
  });

  it('does not mistake a number inside a message for its time', () => {
    const r = parseWhatsappModalText('Reach us at 10:30 daily\n11:00 AM');
    expect(r).toHaveLength(1);
    expect(r?.[0]?.text).toBe('Reach us at 10:30 daily');
  });
});

describe('parseSentAt', () => {
  it('parses a full date as IST and refuses to guess otherwise', () => {
    expect(parseSentAt('14 Nov 2026, 12:45 PM')?.toISOString()).toBe('2026-11-14T07:15:00.000Z');
    expect(parseSentAt('12:45 PM')).toBeNull();
    expect(parseSentAt('14 Nov, 12:45 PM')).toBeNull();
    expect(parseSentAt('Today, 12:45 PM')).toBeNull();
  });
});

describe('bubbleHashes (insert-only dedupe)', () => {
  const a = { text: 'Hi', sentLabel: '10:00 AM' };
  it('is stable across re-reads and keeps genuine identical repeats apart', () => {
    expect(bubbleHashes([a])).toEqual(bubbleHashes([a]));
    const two = bubbleHashes([a, a]);
    expect(two[0]).not.toBe(two[1]);
    // A re-read that grew by one new bubble keeps the old hashes.
    const grown = bubbleHashes([a, { text: 'Bye', sentLabel: '11:00 AM' }]);
    expect(grown[0]).toBe(bubbleHashes([a])[0]);
  });
});

describe('DelhiveryWhatsappPage.read', () => {
  it('reads the window and closes it with Okay', async () => {
    const { page, log } = fakePage({});
    const r = await new DelhiveryWhatsappPage(page).read('123');
    expect(r).toMatchObject({ found: true, available: true });
    expect(r.messages).toHaveLength(2);
    expect(log.clicks).toEqual(['view-whatsapp', 'modal:^okay$']);
  });

  it('button absent → available false, nothing clicked', async () => {
    const { page, log } = fakePage({ button: false });
    const r = await new DelhiveryWhatsappPage(page).read('123');
    expect(r).toEqual({ found: true, available: false, messages: null, ndr: null });
    expect(log.clicks).toEqual([]);
  });

  it('modal that never opens → could not read (null), not "no messages"', async () => {
    const { page } = fakePage({ dialog: false });
    const r = await new DelhiveryWhatsappPage(page).read('123');
    expect(r).toMatchObject({ found: true, available: true, messages: null });
  });

  it('selector drift (modal text changes shape) → null', async () => {
    const { page } = fakePage({ modalText: 'Whatsapp\nsomething else entirely\nOkay' });
    const r = await new DelhiveryWhatsappPage(page).read('123');
    expect(r.messages).toBeNull();
  });

  it('a dialog that is not the WhatsApp one is not read', async () => {
    const { page } = fakePage({ modalText: 'Confirm\n12:00 PM' });
    const r = await new DelhiveryWhatsappPage(page).read('123');
    expect(r.messages).toBeNull();
  });

  it('parcel screen unreachable → found false', async () => {
    const { page } = fakePage({ awbOnScreen: false });
    const r = await new DelhiveryWhatsappPage(page).read('123');
    expect(r).toEqual({ found: false, available: false, messages: null });
  });
});
