// Money is stored as integer minor units (cents / fillér) everywhere.

/** Convert a major-unit number (e.g. 18.1) to minor units (1810). */
export function toMinor(major: number): number {
  return Math.round(major * 100);
}

/**
 * Parse user input like "18,10", "1 234,56", "1,234.56", "-50" or "1.234" into minor units.
 * Returns null for empty / unparsable input.
 */
export function parseAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  let s = input.replace(/[\s\u00a0]/g, '').replace(/[^\d,.\-+]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  if (/[+-]/.test(s)) return null;

  // Decide which separator (if any) is the decimal one:
  //  - both present: the last one is decimal ("1.234,56", "1,234.56")
  //  - one kind, once, not followed by exactly 3 digits: decimal ("18,1", "18.10")
  //  - otherwise it's a thousands separator ("1.234", "1,234,567")
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalAt = -1;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalAt = Math.max(lastComma, lastDot);
  } else {
    const at = Math.max(lastComma, lastDot);
    if (at >= 0) {
      const sep = s[at]!;
      const once = s.indexOf(sep) === at;
      const digitsAfter = s.length - at - 1;
      if (once && digitsAfter !== 3) decimalAt = at;
    }
  }
  const intRaw = decimalAt >= 0 ? s.slice(0, decimalAt) : s;
  const fracPart = decimalAt >= 0 ? s.slice(decimalAt + 1) : '';
  if (/[.,]/.test(fracPart)) return null;
  if (decimalAt >= 0 && intRaw.includes(s[decimalAt]!)) return null;
  // Thousands groups must be exactly 3 digits: "1.234.567" ok, "1.2.3" not.
  const groups = intRaw.split(/[.,]/);
  if (groups.length > 1 && groups.slice(1).some((g) => g.length !== 3)) return null;
  const intPart = groups.join('');
  const n = Number(`${intPart || '0'}.${fracPart || '0'}`);
  if (!Number.isFinite(n)) return null;
  return (neg ? -1 : 1) * toMinor(n);
}

/** Format minor units as a localized currency string. */
export function formatMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return '—';
  const cur = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'EUR';
  try {
    return new Intl.NumberFormat('hu-HU', { style: 'currency', currency: cur }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${cur}`;
  }
}

/** Minor units -> plain editable string, e.g. 1810 -> "18.10". */
export function minorToInput(minor: number | null | undefined): string {
  if (minor == null) return '';
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
