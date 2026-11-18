import { raw } from 'hono/html';

// Small inline SVG icon set (24x24, stroke-based) so the UI needs no external assets.

const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  building:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  flame: '<path d="M12 22c4 0 7-2.8 7-7 0-3.4-2.3-5.8-3.8-7.8-.4 1.8-1.4 3-2.9 3 0-3.2-1.2-6-4.3-8.2.2 4-3 6.6-3 11 0 4.4 3 9 7 9z"/>',
  droplet: '<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.4a10 10 0 0 1 14 0M8.5 15.9a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  receipt:
    '<path d="M5 3v18l2.3-1.5L9.7 21l2.3-1.5 2.3 1.5 2.4-1.5L19 21V3l-2.3 1.5L14.3 3 12 4.5 9.7 3 7.3 4.5z"/><path d="M9 9h6M9 13h6"/>',
  plusMinus: '<path d="M12 4v8M8 8h8M8 18h8"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.2 2.6 2.6 5-5.6"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4.5-6.5"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  inbox: '<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5.5 5h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  mapPin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(p: { name: IconName; size?: number }) {
  const size = p.size ?? 18;
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {raw(PATHS[p.name])}
    </svg>
  );
}

const KIND_ICONS: Record<string, IconName> = {
  rent: 'home',
  condo_fee: 'building',
  adjustment: 'plusMinus',
  utility: 'receipt',
  electricity: 'bolt',
  gas: 'flame',
  water: 'droplet',
  internet: 'wifi',
  other: 'receipt',
};

/** Coloured icon tile for a line kind or utility type. */
export function KindIcon(p: { kind: string; small?: boolean; large?: boolean }) {
  const cls = `kind k-${p.kind}${p.small ? ' sm' : ''}${p.large ? ' lg' : ''}`;
  return (
    <span class={cls}>
      <Icon name={KIND_ICONS[p.kind] ?? 'receipt'} size={p.small ? 16 : p.large ? 26 : 20} />
    </span>
  );
}
