import type { Child } from 'hono/jsx';
import { formatMoney } from '../money';
import { STATUS_LABELS, type User } from '../types';
import { Icon, type IconName } from './icons';

export { Icon, KindIcon } from './icons';

const LIGHT = `
  --bg:#f6f7fb; --bg-glow1:rgba(246,130,31,.10); --bg-glow2:rgba(99,102,241,.08);
  --surface:#ffffff; --surface-2:#f8f9fc; --surface-glass:rgba(255,255,255,.72);
  --fg:#111827; --fg-2:#374151; --muted:#6b7280; --line:#e7e9f0; --line-2:#d6dae4;
  --accent:#f6821f; --accent-2:#e8590c; --accent-soft:rgba(246,130,31,.12); --accent-fg:#ffffff;
  --link:#2563eb; --ok:#059669; --ok-soft:#d1fae5; --bad:#dc2626; --bad-soft:#fee2e2;
  --warn:#b45309; --warn-soft:#fef3c7; --info:#2563eb; --info-soft:#dbeafe;
  --shadow:0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06);
  --shadow-lg:0 2px 4px rgba(16,24,40,.04), 0 18px 40px -12px rgba(16,24,40,.18);
  --ring:0 0 0 4px rgba(246,130,31,.22);
  --k-rent:#6366f1; --k-condo:#0284c7; --k-adj:#db2777; --k-misc:#64748b; --k-el:#ca8a04; --k-gas:#ea580c; --k-water:#0891b2; --k-net:#7c3aed;
  color-scheme: light;`;

const DARK = `
  --bg:#0b0d13; --bg-glow1:rgba(246,130,31,.14); --bg-glow2:rgba(99,102,241,.14);
  --surface:#141821; --surface-2:#1a1f2b; --surface-glass:rgba(16,19,27,.72);
  --fg:#f3f4f6; --fg-2:#d1d5db; --muted:#9aa3b2; --line:#252b38; --line-2:#323a4a;
  --accent:#ff9a3d; --accent-2:#f6821f; --accent-soft:rgba(255,154,61,.14); --accent-fg:#1a0e03;
  --link:#7aa7ff; --ok:#34d399; --ok-soft:rgba(52,211,153,.14); --bad:#f87171; --bad-soft:rgba(248,113,113,.14);
  --warn:#fbbf24; --warn-soft:rgba(251,191,36,.14); --info:#7aa7ff; --info-soft:rgba(122,167,255,.14);
  --shadow:0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.25);
  --shadow-lg:0 2px 4px rgba(0,0,0,.3), 0 18px 40px -12px rgba(0,0,0,.6);
  --ring:0 0 0 4px rgba(255,154,61,.25);
  --k-rent:#a5b4fc; --k-condo:#7dd3fc; --k-adj:#f9a8d4; --k-misc:#cbd5e1; --k-el:#fde047; --k-gas:#fdba74; --k-water:#67e8f9; --k-net:#c4b5fd;
  color-scheme: dark;`;

const CSS = `
:root { ${LIGHT} --radius:16px; --radius-sm:10px; }
:root[data-theme=dark] { ${DARK} }
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) { ${DARK} } }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; min-height:100vh; font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--fg); background:var(--bg);
  background-image:radial-gradient(900px 500px at 0% -10%, var(--bg-glow1), transparent 60%), radial-gradient(800px 500px at 100% 0%, var(--bg-glow2), transparent 60%);
  background-attachment:fixed; -webkit-font-smoothing:antialiased; }
.icon { flex:none; vertical-align:-3px; }
a { color:var(--link); text-decoration:none; } a:hover { text-decoration:underline; }
:focus-visible { outline:none; box-shadow:var(--ring); border-radius:8px; }
h1 { font-size:28px; line-height:1.2; letter-spacing:-.02em; margin:6px 0 18px; font-weight:750; }
h2 { font-size:18px; letter-spacing:-.01em; margin:28px 0 12px; font-weight:700; }
h3 { font-size:15px; margin:0 0 8px; }
h1 .badge, h2 .badge { vertical-align:middle; margin-left:6px; }

/* header */
header.top { position:sticky; top:0; z-index:20; background:var(--surface-glass); backdrop-filter:saturate(180%) blur(14px); -webkit-backdrop-filter:saturate(180%) blur(14px); border-bottom:1px solid var(--line); }
header.top .in, main { max-width:1120px; margin:0 auto; padding:0 20px; }
header.top .in { display:flex; gap:18px; align-items:center; height:60px; }
.brand { display:flex; align-items:center; gap:10px; font-weight:800; letter-spacing:-.02em; color:var(--fg); font-size:17px; }
.brand:hover { text-decoration:none; }
.brand .logo { width:32px; height:32px; border-radius:10px; display:grid; place-items:center; color:#fff;
  background:linear-gradient(135deg,#ffb347 0%,#f6821f 45%,#e8590c 100%); box-shadow:0 6px 16px -6px rgba(246,130,31,.7); }
.brand .logo .icon { width:18px; height:18px; }
header nav { display:flex; gap:4px; flex:1; overflow-x:auto; scrollbar-width:none; }
header nav::-webkit-scrollbar { display:none; }
header nav a { display:flex; align-items:center; gap:7px; color:var(--muted); padding:7px 12px; border-radius:999px; font-weight:550; font-size:14px; white-space:nowrap; transition:background .15s,color .15s; }
header nav a:hover { color:var(--fg); background:var(--surface-2); text-decoration:none; }
header nav a[aria-current=page] { color:var(--accent-2); background:var(--accent-soft); }
.who { display:flex; align-items:center; gap:10px; color:var(--muted); font-size:13px; }
.avatar { width:32px; height:32px; border-radius:50%; display:grid; place-items:center; font-weight:700; font-size:13px; color:#fff; flex:none;
  background:linear-gradient(135deg,#6366f1,#8b5cf6); }
.avatar.admin { background:linear-gradient(135deg,#ffb347,#e8590c); }
.theme-btn { width:36px; height:36px; padding:0; border-radius:50%; display:grid; place-items:center; }
@media (max-width:720px) { .who .email { display:none; } header.top .in { gap:10px; } .brand .name { display:none; } header nav a span { display:none; } header nav a { padding:8px 10px; } }

main { padding-top:26px; padding-bottom:64px; }
.page-head { display:flex; gap:16px; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; margin-bottom:18px; }
.page-head h1 { margin:0; }
.eyebrow { color:var(--muted); font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; display:flex; gap:6px; align-items:center; }
.back { display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:14px; margin-bottom:10px; }
.back:hover { color:var(--fg); text-decoration:none; }

/* surfaces */
.card { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:20px; margin-bottom:18px; box-shadow:var(--shadow); }
.card > h2:first-child, .card > h3:first-child { margin-top:0; }
.grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr)); align-items:start; }
.grid > .card { margin-bottom:0; }
.grid + * { margin-top:18px; }

/* stat tiles */
.stats { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); margin-bottom:22px; }
.stat { position:relative; display:flex; gap:14px; align-items:center; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow); color:var(--fg); overflow:hidden; transition:transform .15s, box-shadow .15s; }
a.stat:hover { transform:translateY(-2px); box-shadow:var(--shadow-lg); text-decoration:none; }
.stat .ico { width:44px; height:44px; border-radius:12px; display:grid; place-items:center; flex:none; background:var(--accent-soft); color:var(--accent-2); }
.stat.warn .ico { background:var(--warn-soft); color:var(--warn); }
.stat.ok .ico { background:var(--ok-soft); color:var(--ok); }
.stat.info .ico { background:var(--info-soft); color:var(--info); }
.stat .lbl { color:var(--muted); font-size:13px; font-weight:550; }
.stat .val { font-size:24px; font-weight:750; letter-spacing:-.02em; line-height:1.2; font-variant-numeric:tabular-nums; }
.stat.attn::after { content:""; position:absolute; top:14px; right:14px; width:8px; height:8px; border-radius:50%; background:var(--warn); box-shadow:0 0 0 4px var(--warn-soft); }

/* tables */
.table-wrap { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); overflow-x:auto; margin-bottom:18px; }
.card .table-wrap { box-shadow:none; margin:0 -20px -20px; border:none; border-top:1px solid var(--line); border-radius:0 0 var(--radius) var(--radius); }
table { width:100%; border-collapse:collapse; background:var(--surface); font-variant-numeric:tabular-nums; }
th, td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--line); vertical-align:middle; }
th { font-size:11.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:650; background:var(--surface-2); white-space:nowrap; }
tbody tr { transition:background .12s; }
tbody tr:hover { background:var(--surface-2); }
tbody tr:last-child td { border-bottom:none; }
td.num, th.num { text-align:right; white-space:nowrap; }
tfoot td { font-weight:750; border-top:1px solid var(--line-2); border-bottom:none; background:var(--surface-2); }
.card > table { margin:4px 0 14px; background:transparent; }
.card > table td:first-child { padding-left:0; } .card > table td:last-child { padding-right:0; text-align:right; }
.card > table td:last-child:has(form) { font-size:0; }
.card > table td:last-child form.inline { display:block; }
.card > table td:last-child form.inline + form.inline { margin-top:6px; }
.card > table tbody tr:hover { background:transparent; }
code { font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--surface-2); border:1px solid var(--line); padding:1px 6px; border-radius:6px; }
td .cell { display:flex; gap:10px; align-items:center; }
table.compact th, table.compact td { padding-left:10px; padding-right:10px; }

/* badges */
.badge { display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:650; background:var(--surface-2); color:var(--muted); white-space:nowrap; border:1px solid var(--line); line-height:1.4; }
.badge::before { content:""; width:6px; height:6px; border-radius:50%; background:currentColor; opacity:.85; }
.badge.pending_review, .badge.draft { background:var(--warn-soft); color:var(--warn); border-color:transparent; }
.badge.approved, .badge.paid { background:var(--ok-soft); color:var(--ok); border-color:transparent; }
.badge.rejected, .badge.duplicate { background:var(--bad-soft); color:var(--bad); border-color:transparent; }
.badge.sent { background:var(--info-soft); color:var(--info); border-color:transparent; }

/* kind icons */
.kind { width:40px; height:40px; border-radius:12px; display:grid; place-items:center; flex:none; background:var(--surface-2); color:var(--muted); }
.kind.sm { width:30px; height:30px; border-radius:9px; }
.kind.lg { width:52px; height:52px; border-radius:15px; }
.k-rent { --k:var(--k-rent); } .k-condo_fee { --k:var(--k-condo); } .k-adjustment { --k:var(--k-adj); }
.k-utility, .k-other { --k:var(--k-misc); } .k-electricity { --k:var(--k-el); } .k-gas { --k:var(--k-gas); }
.k-water { --k:var(--k-water); } .k-internet { --k:var(--k-net); }
.kind[class*=" k-"] { color:var(--k); background:color-mix(in srgb, var(--k) 15%, transparent); }

/* flash */
.flash { display:block; padding:12px 16px; border-radius:var(--radius-sm); margin-bottom:18px; font-weight:550; border:1px solid transparent; animation:slide .35s ease-out; }
.flash .icon { margin-right:8px; }
.flash a { color:inherit; text-decoration:underline; }
.flash.ok { background:var(--ok-soft); color:var(--ok); }
.flash.err { background:var(--bad-soft); color:var(--bad); }
@keyframes slide { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }

.muted { color:var(--muted); font-size:13px; }
.neg { color:var(--ok); }
.total { font-size:34px; font-weight:800; letter-spacing:-.03em; font-variant-numeric:tabular-nums; }

/* forms */
form.inline { display:inline; }
label { display:block; font-size:13px; font-weight:600; color:var(--fg-2); margin:12px 0 6px; }
input, select, textarea { font:inherit; color:var(--fg); padding:9px 12px; border:1px solid var(--line-2); border-radius:var(--radius-sm); width:100%; background:var(--surface); transition:border-color .15s, box-shadow .15s; }
input:hover, select:hover, textarea:hover { border-color:var(--muted); }
input:focus, select:focus, textarea:focus { outline:none; border-color:var(--accent); box-shadow:var(--ring); }
input[type=checkbox] { width:18px; height:18px; accent-color:var(--accent); vertical-align:-3px; }
input[type=file] { padding:8px; background:var(--surface-2); border-style:dashed; }
input[type=file]::file-selector-button { font:inherit; font-weight:600; border:1px solid var(--line-2); background:var(--surface); color:var(--fg); border-radius:8px; padding:5px 12px; margin-right:10px; cursor:pointer; }
.row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
.row > * { flex:1; min-width:130px; }
.row > .shrink { flex:0 0 auto; min-width:0; }
.row label { margin-top:0; }

/* buttons */
button, .btn { font:inherit; font-weight:600; font-size:14px; padding:9px 16px; border-radius:var(--radius-sm); border:1px solid var(--line-2); background:var(--surface); cursor:pointer; color:var(--fg); display:inline-flex; align-items:center; gap:8px; line-height:1.2; transition:transform .1s, box-shadow .15s, background .15s, border-color .15s; white-space:nowrap; }
button:hover, .btn:hover { background:var(--surface-2); border-color:var(--muted); text-decoration:none; }
button:active, .btn:active { transform:translateY(1px); }
button.primary, .btn.primary { background:linear-gradient(180deg,var(--accent),var(--accent-2)); border-color:transparent; color:#fff; box-shadow:0 6px 16px -8px rgba(232,89,12,.8), inset 0 1px 0 rgba(255,255,255,.2); }
button.primary:hover, .btn.primary:hover { filter:brightness(1.06); box-shadow:0 10px 22px -10px rgba(232,89,12,.9), inset 0 1px 0 rgba(255,255,255,.2); }
button.danger, .btn.danger { color:var(--bad); }
button.danger:hover { background:var(--bad-soft); border-color:transparent; }
button.link { border:none; background:none; padding:0; color:var(--bad); font-size:13px; font-weight:550; box-shadow:none; }
button.link:hover { background:none; text-decoration:underline; }
button.link.plain { color:var(--link); }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; align-items:center; }
.actions > form.inline { display:flex; }

/* split / pdf */
iframe.pdf { width:100%; height:80vh; border:1px solid var(--line); border-radius:var(--radius); background:#fff; box-shadow:var(--shadow); }
.split { display:grid; grid-template-columns:minmax(320px,440px) 1fr; gap:18px; align-items:start; }
@media (max-width:860px) { .split { grid-template-columns:1fr; } iframe.pdf { height:60vh; } }

/* preview banner */
.preview { background:linear-gradient(90deg,#4f46e5,#7c3aed); color:#fff; }
.preview .in { max-width:1120px; margin:0 auto; padding:9px 20px; display:flex; gap:16px; align-items:center; justify-content:space-between; flex-wrap:wrap; font-size:14px; }
.preview .in > span { display:flex; gap:8px; align-items:center; }
.preview button { background:rgba(255,255,255,.16); border-color:rgba(255,255,255,.3); color:#fff; box-shadow:none; padding:6px 12px; }
.preview button:hover { background:rgba(255,255,255,.26); }

/* hero */
.hero { position:relative; overflow:hidden; border-radius:22px; padding:28px; margin-bottom:22px; color:#fff;
  background:radial-gradient(600px 300px at 100% 0%, rgba(255,255,255,.18), transparent 60%), linear-gradient(135deg,#ff9f43 0%,#f6821f 38%,#e8590c 72%,#c2410c 100%);
  box-shadow:0 24px 48px -24px rgba(232,89,12,.65); }
.hero.refund { background:radial-gradient(600px 300px at 100% 0%, rgba(255,255,255,.18), transparent 60%), linear-gradient(135deg,#34d399 0%,#10b981 45%,#047857 100%); box-shadow:0 24px 48px -24px rgba(5,150,105,.6); }
.hero.settled { background:radial-gradient(600px 300px at 100% 0%, rgba(255,255,255,.16), transparent 60%), linear-gradient(135deg,#475569 0%,#334155 50%,#1e293b 100%); box-shadow:0 24px 48px -24px rgba(15,23,42,.6); }
.hero::after { content:""; position:absolute; right:-60px; bottom:-90px; width:280px; height:280px; border-radius:50%; border:40px solid rgba(255,255,255,.08); pointer-events:none; }
.hero .hl { font-size:14px; font-weight:600; opacity:.9; display:flex; gap:8px; align-items:center; }
.hero .amount { font-size:clamp(38px,7vw,56px); font-weight:800; letter-spacing:-.035em; line-height:1.05; margin:6px 0 4px; font-variant-numeric:tabular-nums; }
.hero .amount .neg { color:inherit; }
.hero .sub { opacity:.9; font-size:14px; }
.hero .meta { display:flex; gap:10px; flex-wrap:wrap; margin-top:18px; position:relative; z-index:1; }
.chip { display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; font-size:13px; font-weight:600; background:rgba(255,255,255,.18); color:#fff; backdrop-filter:blur(6px); }
a.chip:hover { background:rgba(255,255,255,.28); text-decoration:none; }
.hero .badge { background:rgba(255,255,255,.22); color:#fff; }
.hero .actions { position:relative; z-index:1; }
.hero .actions button, .hero .actions .btn { background:rgba(255,255,255,.16); border-color:rgba(255,255,255,.32); color:#fff; box-shadow:none; }
.hero .actions button:hover, .hero .actions .btn:hover { background:rgba(255,255,255,.28); }
.hero .actions button.primary { background:#fff; color:#c2410c; border-color:#fff; }
.hero.refund .actions button.primary { color:#047857; }
.hero .actions button.danger { color:#fff; }

/* stepper */
.stepper { list-style:none; display:flex; margin:22px 0 0; padding:0; gap:0; position:relative; z-index:1; max-width:520px; }
.stepper li { flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:6px; position:relative; font-size:13px; font-weight:600; opacity:.7; }
.stepper li .dot { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; background:rgba(255,255,255,.2); border:2px solid rgba(255,255,255,.5); position:relative; z-index:1; }
.stepper li:not(:last-child)::after { content:""; position:absolute; top:12px; left:26px; right:0; height:2px; background:rgba(255,255,255,.3); }
.stepper li.done, .stepper li.cur { opacity:1; }
.stepper li.done .dot { background:#fff; color:#c2410c; border-color:#fff; }
.hero.refund .stepper li.done .dot { color:#047857; }
.hero.settled .stepper li.done .dot { color:#334155; }
.stepper li.done:not(:last-child)::after { background:#fff; }
.stepper li.cur .dot { background:#fff; border-color:#fff; box-shadow:0 0 0 6px rgba(255,255,255,.25); }
.stepper li.cur .dot::after { content:""; width:8px; height:8px; border-radius:50%; background:#e8590c; }
.stepper small { font-weight:500; opacity:.85; font-size:12px; }

/* line item list */
.lines { list-style:none; margin:0; padding:0; }
.lines li { display:flex; gap:14px; align-items:center; padding:14px 20px; border-bottom:1px solid var(--line); }
.lines li:last-child { border-bottom:none; }
.lines .desc { flex:1; min-width:0; }
.lines .desc .t { font-weight:600; overflow-wrap:anywhere; }
.lines .docs { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
.lines .amt { font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; text-align:right; }
.lines .sum { background:var(--surface-2); font-weight:750; font-size:16px; border-radius:0 0 var(--radius) var(--radius); }
.lines .sum .amt { font-size:20px; }
.card.flush { padding:0; overflow:hidden; }
.card.flush > .card-head { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:10px; }
.card.flush > .card-head h2 { margin:0; font-size:16px; }
.doc { display:inline-flex; align-items:center; gap:5px; font-size:12.5px; font-weight:600; padding:3px 10px; border-radius:999px; background:var(--surface-2); border:1px solid var(--line); color:var(--fg-2); }
.nowrap { white-space:nowrap; }
.clip { max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.docs-cell { display:flex; gap:6px; flex-wrap:nowrap; align-items:center; white-space:nowrap; }
.doc:hover { border-color:var(--accent); color:var(--accent-2); text-decoration:none; }
.doc .icon { width:14px; height:14px; }

/* statement cards */
.st-list { display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); }
.st-card { display:flex; flex-direction:column; gap:12px; padding:18px; border-radius:var(--radius); background:var(--surface); border:1px solid var(--line); box-shadow:var(--shadow); color:var(--fg); transition:transform .15s, box-shadow .15s, border-color .15s; }
.st-card:hover { transform:translateY(-3px); box-shadow:var(--shadow-lg); border-color:var(--line-2); text-decoration:none; }
.st-card .top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
.st-card .m { font-weight:700; font-size:16px; }
.st-card .amt { font-size:26px; font-weight:800; letter-spacing:-.02em; font-variant-numeric:tabular-nums; }
.st-card .foot { display:flex; justify-content:space-between; align-items:center; color:var(--muted); font-size:13px; }
.st-card .foot .go { color:var(--accent-2); display:flex; align-items:center; gap:4px; font-weight:600; }

.loc-head { display:flex; gap:14px; align-items:center; margin:28px 0 14px; }
.loc-head h2 { margin:0; }

/* empty state */
.empty { text-align:center; padding:44px 20px; color:var(--muted); }
.empty .ico { width:64px; height:64px; margin:0 auto 14px; border-radius:20px; display:grid; place-items:center; background:var(--accent-soft); color:var(--accent-2); }
.empty b { display:block; color:var(--fg); font-size:16px; margin-bottom:4px; }

/* comments */
.comment { display:flex; gap:12px; margin:14px 0; }
.comment .bubble { flex:1; background:var(--surface); border:1px solid var(--line); border-radius:4px 16px 16px 16px; padding:12px 16px; box-shadow:var(--shadow); }
.comment.mine { flex-direction:row-reverse; }
.comment.mine .bubble { border-radius:16px 4px 16px 16px; background:var(--accent-soft); border-color:transparent; }
.comment .body { white-space:pre-wrap; overflow-wrap:anywhere; }
.comment .who-line { font-size:13px; color:var(--muted); margin-bottom:4px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.comment .who-line b { color:var(--fg); }
.comment:not(:has(.bubble)) { border-left:3px solid var(--line); padding:4px 12px; display:block; }

/* segmented filter */
.seg { display:inline-flex; gap:2px; padding:4px; border-radius:999px; background:var(--surface); border:1px solid var(--line); box-shadow:var(--shadow); max-width:100%; overflow-x:auto; scrollbar-width:none; }
.seg a { padding:6px 14px; border-radius:999px; color:var(--muted); font-weight:600; font-size:13.5px; white-space:nowrap; }
.seg a:hover { color:var(--fg); text-decoration:none; background:var(--surface-2); }
.seg a[aria-current=page] { color:#fff; background:linear-gradient(180deg,var(--accent),var(--accent-2)); box-shadow:0 4px 12px -6px rgba(232,89,12,.8); }
a.hero { transition:transform .18s, box-shadow .18s; }
a.hero:hover { transform:translateY(-3px); box-shadow:0 30px 56px -24px rgba(232,89,12,.75); }
a.hero.refund:hover { box-shadow:0 30px 56px -24px rgba(5,150,105,.7); }
a.hero.settled:hover { box-shadow:0 30px 56px -24px rgba(15,23,42,.7); }
pre { background:var(--surface-2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:12px; overflow:auto; font-size:12.5px; }
details summary { cursor:pointer; font-weight:600; color:var(--fg-2); }

.tag { display:inline-flex; align-items:center; gap:4px; font-size:12px; padding:1px 8px; border-radius:999px; background:var(--surface-2); color:var(--muted); border:1px solid var(--line); }

footer.site { max-width:1120px; margin:0 auto; padding:0 20px 36px; color:var(--muted); font-size:12.5px; display:flex; gap:8px; align-items:center; }

@media (max-width:600px) {
  h1 { font-size:24px; } .hero { padding:22px; border-radius:18px; } .card { padding:16px; }
  .card .table-wrap { margin:0 -16px -16px; } .lines li { padding:12px 16px; } .stepper small { display:none; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
@media print {
  body { background:#fff; color:#000; } header.top, .preview, .actions, form, .no-print, footer.site, .theme-btn { display:none !important; }
  .card, .table-wrap, .st-card { box-shadow:none; } .hero { color:#000; background:#fff !important; border:1px solid #ccc; box-shadow:none; }
  .hero .chip, .hero .badge { background:#eee; color:#000; } main { padding:0; }
}
`;

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset=".5" stop-color="#f6821f"/><stop offset="1" stop-color="#e8590c"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><path d="M10 7v18l2-1.3 2 1.3 2-1.3 2 1.3 2-1.3 2 1.3V7l-2 1.3L18 7l-2 1.3L14 7l-2 1.3z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M13 13h6M13 17h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  );

// Runs before paint: apply the stored theme, then (after load) mark the active nav link.
const HEAD_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}})();
function toggleTheme(){var d=document.documentElement,dark=d.dataset.theme?d.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches,n=dark?'light':'dark';d.dataset.theme=n;try{localStorage.setItem('theme',n)}catch(e){}}
document.addEventListener('DOMContentLoaded',function(){var p=location.pathname,best=null,len=-1;document.querySelectorAll('header nav a').forEach(function(a){var h=a.getAttribute('href');if((p===h||p.indexOf(h==='/'?'/statements':h+'/')===0||(h==='/'&&p==='/'))&&h.length>len){best=a;len=h.length}});if(best)best.setAttribute('aria-current','page')});`;

function initials(u?: User) {
  const src = (u?.name || u?.email || '?').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (u?.name ? (parts[1]?.[0] ?? '') : '')).toUpperCase();
}

export const Avatar = (p: { user?: User | { name: string | null; email: string; role: string } }) => (
  <span class={`avatar${p.user?.role === 'admin' ? ' admin' : ''}`} title={p.user?.email}>
    {initials(p.user as User)}
  </span>
);

const NavLink = (p: { href: string; icon: IconName; label: string }) => (
  <a href={p.href}>
    <Icon name={p.icon} size={17} />
    <span>{p.label}</span>
  </a>
);

export function Layout(props: {
  title: string;
  user?: User;
  /** Set when an admin is previewing the site as `user`. */
  impersonator?: User;
  flash?: { ok?: string; err?: string };
  children: Child;
}) {
  const admin = props.user?.role === 'admin';
  return (
    <html lang="hu">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f6f7fb" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0b0d13" media="(prefers-color-scheme: dark)" />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href={FAVICON} />
        <title>{props.title} · auto-bill</title>
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        {props.impersonator && (
          <div class="preview">
            <div class="in">
              <span>
                <Icon name="eye" />
                Bérlői nézet: <b>{props.user?.name ?? props.user?.email}</b> — így látja az oldalt. Csak olvasható.
              </span>
              <form class="inline" method="post" action="/view-as/stop">
                <button>
                  <Icon name="arrowLeft" size={16} /> Vissza az admin nézetbe
                </button>
              </form>
            </div>
          </div>
        )}
        <header class="top">
          <div class="in">
            <a class="brand" href="/">
              <span class="logo">
                <Icon name="receipt" />
              </span>
              <span class="name">auto-bill</span>
            </a>
            <nav>
              {admin ? (
                <>
                  <NavLink href="/admin" icon="grid" label="Áttekintés" />
                  <NavLink href="/admin/bills" icon="inbox" label="Számlák" />
                  <NavLink href="/admin/locations" icon="building" label="Ingatlanok" />
                  <NavLink href="/admin/users" icon="users" label="Felhasználók" />
                </>
              ) : (
                <NavLink href="/" icon="receipt" label="Elszámolásaim" />
              )}
            </nav>
            <button class="theme-btn" type="button" onclick="toggleTheme()" title="Világos / sötét mód" aria-label="Világos / sötét mód">
              <Icon name="moon" size={17} />
            </button>
            {props.user && (
              <span class="who">
                <span class="email">{props.user.email}</span>
                <Avatar user={props.user} />
              </span>
            )}
          </div>
        </header>
        <main>
          {props.flash?.ok && (
            <div class="flash ok" role="status">
              <Icon name="checkCircle" /> {props.flash.ok}
            </div>
          )}
          {props.flash?.err && (
            <div class="flash err" role="alert">
              <Icon name="alert" /> {props.flash.err}
            </div>
          )}
          {props.children}
        </main>
        <footer class="site">
          <Icon name="receipt" size={14} /> auto-bill · rezsi és bérleti elszámolások
        </footer>
      </body>
    </html>
  );
}

export const Badge = (p: { status: string }) => <span class={`badge ${p.status}`}>{STATUS_LABELS[p.status] ?? p.status}</span>;

export const Money = (p: { amount: number | null | undefined; currency: string | null | undefined }) => (
  <span class={p.amount != null && p.amount < 0 ? 'neg' : ''}>{formatMoney(p.amount, p.currency)}</span>
);

/** Horizontal-scroll wrapper so wide tables work on phones. */
export const TableWrap = (p: { children: Child }) => <div class="table-wrap">{p.children}</div>;

export const Empty = (p: { icon: IconName; title: string; children?: Child }) => (
  <div class="empty">
    <div class="ico">
      <Icon name={p.icon} size={28} />
    </div>
    <b>{p.title}</b>
    {p.children}
  </div>
);

const HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

/** "2026-11" -> "2026. november" (falls back to the input). */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? HU_MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${m[1]}. ${name}` : month;
}

/** A POST button, optionally with a confirm() prompt. */
export const PostButton = (p: {
  action: string;
  label: string;
  cls?: string;
  confirm?: string;
  fields?: Record<string, string>;
  icon?: IconName;
}) => (
  <form class="inline" method="post" action={p.action} onsubmit={p.confirm ? `return confirm(${JSON.stringify(p.confirm)})` : undefined}>
    {Object.entries(p.fields ?? {}).map(([k, v]) => (
      <input type="hidden" name={k} value={v} />
    ))}
    <button class={p.cls}>
      {p.icon && <Icon name={p.icon} size={16} />}
      {p.label}
    </button>
  </form>
);

export function Options<T extends string>(p: { values: readonly T[]; selected?: string | null; labels?: Record<string, string> }) {
  return (
    <>
      {p.values.map((v) => (
        <option value={v} selected={v === p.selected}>
          {p.labels?.[v] ?? v}
        </option>
      ))}
    </>
  );
}
