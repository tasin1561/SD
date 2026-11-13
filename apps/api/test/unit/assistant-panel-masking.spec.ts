import { maskPhones, maskPhonesDeep } from '../../src/modules/assistant/assistant-masking';
import { reviewBlocks } from '../../src/modules/assistant/services/assistant-panel.service';

describe('assistant panel: phone masking', () => {
  it.each([
    ['call +91 98765 43606 please', 'call +91 98•••••606 please'],
    ['+919876543606', '+91 98•••••606'],
    ['01712345678', '01••••••678'],
    ['9876543606', '98•••••606'],
    ['+8801712345678', '+880 17•••••678'],
  ])('masks %s', (input, expected) => {
    const out = maskPhones(input);
    expect(out).toBe(expected);
  });

  it('leaves order numbers, pincodes and amounts alone', () => {
    const t = 'Order SD-100234 to pincode 110001 costs 1250.50 on 2026-11-13';
    expect(maskPhones(t)).toBe(t);
  });

  it('masks inside tool inputs and results, keys untouched', () => {
    const out = maskPhonesDeep({ phone: '+919876543606', nested: [{ note: 'ring 9876543606' }] });
    expect(JSON.stringify(out)).not.toContain('9876543606');
    expect(Object.keys(out as object)).toEqual(['phone', 'nested']);
  });
});

describe('assistant panel: reviewBlocks', () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: 'customer phone +919876543606' },
    { type: 'tool_use', id: 't', name: 'get_order', input: { phone: '9876543606' } },
    { type: 'tool_result', tool_use_id: 't', content: 'ring 9876543606' },
  ];

  it('never returns thinking blocks and masks by default', () => {
    const r = reviewBlocks(content, false);
    expect(r.blocks.map((b) => (b as { type: string }).type)).toEqual([
      'text',
      'tool_use',
      'tool_result',
    ]);
    expect(JSON.stringify(r.blocks)).not.toContain('9876543606');
    expect(r.masked).toBe(3);
  });

  it('reveal returns the real text, still without thinking', () => {
    const r = reviewBlocks(content, true);
    expect(JSON.stringify(r.blocks)).toContain('9876543606');
    expect(JSON.stringify(r.blocks)).not.toContain('thinking');
    expect(r.masked).toBe(0);
  });
});
