/** Contract numbers are compared without whitespace and case-insensitively. */
export function normalizeContract(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.replace(/\s+/g, '').toUpperCase();
  return s || null;
}

export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Entries are full addresses ("me@gmail.com") or domains ("@epal.pt").
 * A sender passes if any of the candidate addresses matches any entry.
 */
export function senderAllowed(allowlist: string | undefined, candidates: (string | null | undefined)[]): boolean {
  const entries = parseList(allowlist);
  if (entries.length === 0) return false;
  return candidates.some((raw) => {
    // Ignore "+tag" sub-addressing: Gmail auto-forwards from user+caf_=…@gmail.com.
    const addr = raw?.trim().toLowerCase().replace(/\+[^@]*@/, '@');
    if (!addr || !addr.includes('@')) return false;
    const domain = addr.slice(addr.lastIndexOf('@'));
    return entries.some((e) => (e.startsWith('@') ? domain === e : addr === e));
  });
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function isMonth(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function isDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function nullIfEmpty(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}
