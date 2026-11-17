import { Hono } from 'hono';
import { getBill } from '../db';
import type { AppEnv } from '../types';
import { canSeeBill, intParam, notFound } from './common';

export const files = new Hono<AppEnv>();

files.get('/bills/:id/:kind{pdf|proof|raw}', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const kind = c.req.param('kind');
  const user = c.get('user');
  if (kind === 'raw' && user.role !== 'admin') return notFound(c);
  if (!(await canSeeBill(c.env.DB, user, id))) return notFound(c);

  const bill = await getBill(c.env.DB, id);
  const key = kind === 'pdf' ? bill?.pdf_key : kind === 'proof' ? bill?.proof_key : bill?.raw_email_key;
  if (!key) return notFound(c);
  const obj = await c.env.FILES.get(key);
  if (!obj) return notFound(c);

  const ext = kind === 'raw' ? 'eml' : (key.split('.').pop() ?? 'bin');
  const headers = new Headers({
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'content-disposition': `${kind === 'raw' ? 'attachment' : 'inline'}; filename="bill-${id}-${kind}.${ext}"`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=300',
  });
  // Uploaded files are untrusted: never let them run script in our origin. PDFs still render in the viewer.
  if (kind !== 'pdf' || !headers.get('content-type')?.includes('pdf')) headers.set('content-security-policy', 'sandbox');
  return new Response(obj.body, { headers });
});
