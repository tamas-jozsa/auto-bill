import type { Child } from 'hono/jsx';
import { formatMoney } from '../money';
import type { User } from '../types';

const CSS = `
:root { --fg:#1d2433; --muted:#667085; --line:#e4e7ec; --bg:#f7f8fa; --accent:#f6821f; --ok:#12805c; --bad:#c4320a; --warn:#b54708; }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--fg); background:var(--bg); }
header { background:#fff; border-bottom:1px solid var(--line); }
header .in, main { max-width:1100px; margin:0 auto; padding:12px 20px; }
header .in { display:flex; gap:20px; align-items:center; }
header .brand { font-weight:700; color:var(--accent); text-decoration:none; }
header nav { display:flex; gap:14px; flex:1; }
header nav a { color:var(--fg); text-decoration:none; }
header .who { color:var(--muted); font-size:13px; }
h1 { font-size:22px; margin:8px 0 16px; } h2 { font-size:17px; margin:24px 0 10px; }
a { color:#175cd3; }
.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; }
.grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); }
table { width:100%; border-collapse:collapse; background:#fff; }
th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; text-transform:uppercase; color:var(--muted); font-weight:600; }
td.num, th.num { text-align:right; white-space:nowrap; }
tfoot td { font-weight:700; border-bottom:none; }
.badge { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; background:#eef2f6; color:var(--muted); white-space:nowrap; }
.badge.pending_review, .badge.draft { background:#fef0c7; color:var(--warn); }
.badge.approved, .badge.paid { background:#d1fadf; color:var(--ok); }
.badge.rejected, .badge.duplicate { background:#fee4e2; color:var(--bad); }
.badge.sent { background:#d1e9ff; color:#175cd3; }
.flash { padding:10px 14px; border-radius:6px; margin-bottom:16px; }
.flash.ok { background:#d1fadf; } .flash.err { background:#fee4e2; }
.muted { color:var(--muted); font-size:13px; }
.neg { color:var(--ok); }
form.inline { display:inline; }
label { display:block; font-size:13px; color:var(--muted); margin:8px 0 2px; }
input, select, textarea { font:inherit; padding:6px 8px; border:1px solid #d0d5dd; border-radius:6px; width:100%; background:#fff; }
input[type=checkbox] { width:auto; }
.row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
.row > * { flex:1; min-width:120px; }
.row > .shrink { flex:0 0 auto; min-width:0; }
button, .btn { font:inherit; padding:6px 14px; border-radius:6px; border:1px solid #d0d5dd; background:#fff; cursor:pointer; text-decoration:none; color:var(--fg); display:inline-block; }
button.primary, .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
button.danger { color:var(--bad); }
button.link { border:none; background:none; padding:0; color:var(--bad); font-size:13px; }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
iframe.pdf { width:100%; height:80vh; border:1px solid var(--line); border-radius:8px; background:#fff; }
.split { display:grid; grid-template-columns: minmax(320px, 420px) 1fr; gap:16px; }
@media (max-width: 800px) { .split { grid-template-columns: 1fr; } iframe.pdf { height:60vh; } }
.comment { border-left:3px solid var(--line); padding:4px 10px; margin:8px 0; }
.total { font-size:28px; font-weight:700; }
`;

export function Layout(props: { title: string; user?: User; flash?: { ok?: string; err?: string }; children: Child }) {
  const admin = props.user?.role === 'admin';
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · auto-bill</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header>
          <div class="in">
            <a class="brand" href="/">auto-bill</a>
            <nav>
              {admin ? (
                <>
                  <a href="/admin">Dashboard</a>
                  <a href="/admin/bills">Bills</a>
                  <a href="/admin/locations">Locations</a>
                  <a href="/admin/users">Users</a>
                </>
              ) : (
                <a href="/">My statements</a>
              )}
            </nav>
            {props.user && <span class="who">{props.user.email}</span>}
          </div>
        </header>
        <main>
          {props.flash?.ok && <div class="flash ok">{props.flash.ok}</div>}
          {props.flash?.err && <div class="flash err">{props.flash.err}</div>}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export const Badge = (p: { status: string }) => <span class={`badge ${p.status}`}>{p.status.replace('_', ' ')}</span>;

export const Money = (p: { amount: number | null | undefined; currency: string | null | undefined }) => (
  <span class={p.amount != null && p.amount < 0 ? 'neg' : ''}>{formatMoney(p.amount, p.currency)}</span>
);

/** A POST button, optionally with a confirm() prompt. */
export const PostButton = (p: { action: string; label: string; cls?: string; confirm?: string; fields?: Record<string, string> }) => (
  <form class="inline" method="post" action={p.action} onsubmit={p.confirm ? `return confirm(${JSON.stringify(p.confirm)})` : undefined}>
    {Object.entries(p.fields ?? {}).map(([k, v]) => (
      <input type="hidden" name={k} value={v} />
    ))}
    <button class={p.cls}>{p.label}</button>
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
