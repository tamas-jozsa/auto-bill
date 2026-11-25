import { describe, expect, it } from 'vitest';
import { normalizeExtraction, parseModelOutput } from '../src/extract';
import { formatMoney, minorToInput, parseAmount } from '../src/money';
import { utilityLineDescription } from '../src/statements';
import { isDate, isMonth, normalizeContract, senderAllowed } from '../src/util';

describe('parseAmount', () => {
  it.each([
    ['18,10', 1810],
    ['18.10', 1810],
    ['18,1', 1810],
    ['1 234,56', 123456],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234', 123400],
    ['12 345 Ft', 1234500],
    ['€ 850', 85000],
    ['-120', -12000],
    ['-0,5', -50],
    ['0', 0],
  ])('%s -> %d', (input, expected) => expect(parseAmount(input)).toBe(expected));

  it.each(['', '   ', 'abc', '1-2', '1,2,3.4.5x', '1.2.3,4,5'])('rejects %j', (input) => expect(parseAmount(input)).toBeNull());
});

describe('money formatting', () => {
  it('round-trips through the edit input', () => {
    for (const v of [0, 5, 1810, -12000, 123456]) expect(parseAmount(minorToInput(v))).toBe(v);
  });
  it('formats currencies', () => {
    expect(formatMoney(1810, 'EUR')).toMatch(/18,10/);
    expect(formatMoney(null, 'EUR')).toBe('—');
  });
});

describe('senderAllowed', () => {
  const list = 'me@gmail.com, @epal.pt';
  it('matches exact addresses case-insensitively', () => expect(senderAllowed(list, ['Me@Gmail.com'])).toBe(true));
  it('matches domains', () => expect(senderAllowed(list, [null, 'faturas@epal.pt'])).toBe(true));
  it('does not match subdomain tricks', () => expect(senderAllowed(list, ['x@evil-epal.pt', 'me@gmail.com.evil.io'])).toBe(false));
  it('ignores +tag sub-addressing (Gmail auto-forward)', () =>
    expect(senderAllowed(list, ['me+caf_=bills=tamasjozsa.net@gmail.com', 'faturas@other.pt'])).toBe(true));
  it('rejects everything when empty', () => expect(senderAllowed('', ['me@gmail.com'])).toBe(false));
});

describe('validators', () => {
  it('normalizes contract numbers', () => expect(normalizeContract(' 42 0032 1556 ')).toBe('4200321556'));
  it('checks dates', () => {
    expect(isDate('2025-10-02')).toBe(true);
    expect(isDate('2025-02-30')).toBe(false);
    expect(isDate('02.10.2025')).toBe(false);
  });
  it('checks months', () => {
    expect(isMonth('2026-11')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
  });
});

describe('extraction', () => {
  it('parses object and string model output', () => {
    expect(parseModelOutput({ response: { a: 1 } })).toEqual({ a: 1 });
    expect(parseModelOutput({ response: 'Sure!\n```json\n{"a": 2}\n```' })).toEqual({ a: 2 });
    expect(() => parseModelOutput({ response: 'no json here' })).toThrow();
  });

  it('normalizes the EPAL sample', () => {
    const r = normalizeExtraction({
      contract_number: '30123372',
      utility_type: 'Water',
      provider: 'EPAL',
      invoice_number: 'FT 20250/02287288',
      amount: 18.1,
      currency: 'eur',
      issue_date: '2025.09.11',
      due_date: '2025-10-02',
      period_start: '2025-08-11',
      period_end: '2025-09-10',
      notes: null,
    });
    expect(r).toEqual({
      contract_number: '30123372',
      utility_type: 'water',
      provider: 'EPAL',
      invoice_number: 'FT 20250/02287288',
      amount: 1810,
      currency: 'EUR',
      issue_date: '2025-09-11',
      due_date: '2025-10-02',
      period_start: '2025-08-11',
      period_end: '2025-09-10',
      notes: null,
    });
  });

  it('drops garbage instead of throwing', () => {
    const r = normalizeExtraction({ utility_type: 'plasma', amount: 'lots', due_date: 'tomorrow', currency: 'euros', contract_number: 42 });
    expect(r.utility_type).toBe('other');
    expect(r.amount).toBeNull();
    expect(r.due_date).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.contract_number).toBe('42');
    expect(normalizeExtraction(null).utility_type).toBe('other');
  });

  it('keeps credits negative', () => expect(normalizeExtraction({ amount: -2500.5 }).amount).toBe(-250050));
});

describe('utilityLineDescription', () => {
  it('uses period when present, else invoice number', () => {
    expect(
      utilityLineDescription({ utility_type: 'water', provider: 'EPAL', period_start: '2025-08-11', period_end: '2025-09-10', invoice_number: 'X' }),
    ).toBe('Víz · EPAL · 2025-08-11 – 2025-09-10');
    expect(utilityLineDescription({ utility_type: 'gas', provider: null, period_start: null, period_end: null, invoice_number: '123' })).toBe(
      'Gáz · #123',
    );
  });
});

describe('email-only bills', async () => {
  const { emailBodyText, invoiceLinks } = await import('../src/intake');
  const { normalizeExtraction } = await import('../src/extract');
  const body = `Számla összege: 6056 Ft\n\n https://zafirportal.hu/e-invoice/31a4c40d-1eb1-457d-8bb7-26be58f9b615\n\nA portál elérhetősége: https://zafirportal.hu`;
  it('keeps invoice links, drops bare portal links', () =>
    expect(invoiceLinks(body)).toEqual(['https://zafirportal.hu/e-invoice/31a4c40d-1eb1-457d-8bb7-26be58f9b615']));
  it('falls back to stripped HTML', () =>
    expect(emailBodyText({ html: '<p>Összeg: <b>6056&nbsp;Ft</b></p><a href="https://x.hu/inv/1">link</a>' })).toContain('6056 Ft'));
  it('normalizes Hungarian dates and Ft', () => {
    const f = normalizeExtraction({ due_date: '2026.06.15.', currency: 'Ft', amount: 6056 });
    expect([f.due_date, f.currency, f.amount]).toEqual(['2026-06-15', 'HUF', 605600]);
  });
});
