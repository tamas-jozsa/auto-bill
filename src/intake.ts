import PostalMime from 'postal-mime';
import { first, getContractByNumber } from './db';
import { extractFields, pdfToText, type Extracted } from './extract';
import { senderAllowed } from './util';

export interface IngestInput {
  bytes: ArrayBuffer;
  filename: string;
  source: 'email' | 'upload';
  rawEmailKey?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
}

/** Store a bill PDF, extract fields with AI and create a `pending_review` bill. Returns the bill id. */
export async function ingestPdf(env: Env, input: IngestInput): Promise<number> {
  const pdfKey = `bills/${crypto.randomUUID()}.pdf`;
  await env.FILES.put(pdfKey, input.bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { filename: input.filename.slice(0, 200) },
  });

  let fields: Extracted | null = null;
  let extraction: string;
  try {
    const text = await pdfToText(env, input.filename, input.bytes);
    if (text.replace(/\s/g, '').length < 50) throw new Error('A PDF-ben nincs olvasható szöveg (szkennelt kép?)');
    const result = await extractFields(env, text);
    fields = result.fields;
    extraction = JSON.stringify({ model: env.AI_MODEL, raw: result.raw });
  } catch (err) {
    extraction = JSON.stringify({ model: env.AI_MODEL, error: String(err) });
    console.error('extraction failed', input.filename, err);
  }

  return insertBill(env.DB, {
    source: input.source,
    fields,
    pdfKey,
    rawEmailKey: input.rawEmailKey ?? null,
    emailFrom: input.emailFrom ?? null,
    emailSubject: input.emailSubject ?? null,
    extraction,
    notes: fields ? fields.notes : 'Az automatikus adatkinyerés nem sikerült — töltse ki a mezőket kézzel.',
  });
}

/** Re-run extraction on an existing bill and overwrite its fields (keeps status pending_review). */
export async function reextractBill(env: Env, bill: { id: number; pdf_key: string | null; raw_email_key: string | null }): Promise<void> {
  let text: string;
  let notesExtra: string[] = [];
  if (bill.pdf_key) {
    const obj = await env.FILES.get(bill.pdf_key);
    if (!obj) throw new Error('PDF not found in R2');
    text = await pdfToText(env, obj.customMetadata?.filename ?? 'bill.pdf', await obj.arrayBuffer());
  } else if (bill.raw_email_key) {
    const email = await readStoredEmail(env, bill.raw_email_key);
    if (!email) throw new Error('Az eredeti e-mail nem található');
    text = emailPrompt(email);
    notesExtra = emailNotes(email);
  } else {
    throw new Error('Nincs PDF vagy e-mail, amiből adatot lehetne kinyerni');
  }
  const { fields, raw } = await extractFields(env, text);
  fields.notes = [fields.notes, ...notesExtra].filter(Boolean).join('\n') || null;
  const loc = await resolveLocation(env.DB, fields);
  await env.DB.prepare(
    `UPDATE bills SET contract_number = ?, utility_type = ?, provider = ?, invoice_number = ?, amount = ?,
       currency = ?, issue_date = ?, due_date = ?, period_start = ?, period_end = ?, notes = ?,
       location_id = COALESCE(?, location_id), extraction = ?, status = 'pending_review', updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      fields.contract_number,
      loc.utilityType ?? fields.utility_type,
      fields.provider,
      fields.invoice_number,
      fields.amount,
      fields.currency,
      fields.issue_date,
      fields.due_date,
      fields.period_start,
      fields.period_end,
      fields.notes,
      loc.locationId,
      JSON.stringify({ model: env.AI_MODEL, raw }),
      bill.id,
    )
    .run();
}

async function resolveLocation(db: D1Database, fields: Extracted | null) {
  if (!fields?.contract_number) return { locationId: null, utilityType: null };
  const contract = await getContractByNumber(db, fields.contract_number);
  return { locationId: contract?.location_id ?? null, utilityType: contract?.utility_type ?? null };
}

async function insertBill(
  db: D1Database,
  b: {
    source: 'email' | 'upload';
    fields: Extracted | null;
    pdfKey: string | null;
    rawEmailKey: string | null;
    emailFrom: string | null;
    emailSubject: string | null;
    extraction: string | null;
    notes: string | null;
  },
): Promise<number> {
  const f = b.fields;
  const loc = await resolveLocation(db, f);

  let status = 'pending_review';
  if (f?.contract_number && f.invoice_number) {
    const dup = await first(
      db,
      "SELECT id FROM bills WHERE contract_number = ? AND invoice_number = ? AND status != 'duplicate' LIMIT 1",
      f.contract_number,
      f.invoice_number,
    );
    if (dup) status = 'duplicate';
  }

  const row = await db
    .prepare(
      `INSERT INTO bills (status, source, location_id, contract_number, utility_type, provider, invoice_number, amount,
         currency, issue_date, due_date, period_start, period_end, notes, pdf_key, raw_email_key, email_from,
         email_subject, extraction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      status,
      b.source,
      loc.locationId,
      f?.contract_number ?? null,
      loc.utilityType ?? f?.utility_type ?? 'other',
      f?.provider ?? null,
      f?.invoice_number ?? null,
      f?.amount ?? null,
      f?.currency ?? null,
      f?.issue_date ?? null,
      f?.due_date ?? null,
      f?.period_start ?? null,
      f?.period_end ?? null,
      b.notes,
      b.pdfKey,
      b.rawEmailKey,
      b.emailFrom,
      b.emailSubject,
      b.extraction,
    )
    .first<{ id: number }>();
  if (!row) throw new Error('bill insert failed');
  return row.id;
}

export interface EmailContent {
  from: string | null;
  subject: string | null;
  text: string;
}

/** Plain text of an email; falls back to stripping the HTML part. */
export function emailBodyText(parsed: { text?: string; html?: string }): string {
  if (parsed.text?.trim()) return parsed.text.trim();
  return (parsed.html ?? '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Links that look like a specific invoice (not just a portal home page). */
export function invoiceLinks(text: string): string[] {
  const urls = [...new Set(text.match(/https:\/\/[^\s<>"')\]]+/g) ?? [])].map((u) => u.replace(/[.,;]+$/, ''));
  return urls.filter((u) => {
    try {
      const url = new URL(u);
      return url.pathname.length > 1 && !/unsubscribe|leiratkoz|privacy|adatvedelem|facebook|instagram|google\.com/i.test(u);
    } catch {
      return false;
    }
  }).slice(0, 3);
}

const emailPrompt = (e: EmailContent) =>
  `This is an e-mail notification about a bill (there is no PDF attached).\nFrom: ${e.from ?? ''}\nSubject: ${e.subject ?? ''}\n\n${e.text}`;

const emailNotes = (e: EmailContent) => {
  const links = invoiceLinks(e.text);
  return ['Nem volt PDF csatolva — az adatok az e-mail szövegéből származnak.', ...links.map((l) => `Számla linkje: ${l}`)];
};

export async function readStoredEmail(env: Env, key: string): Promise<EmailContent | null> {
  const obj = await env.FILES.get(key);
  if (!obj) return null;
  const parsed = await PostalMime.parse(await obj.arrayBuffer());
  const from = parsed.from && 'address' in parsed.from ? (parsed.from.address ?? null) : null;
  return { from, subject: parsed.subject ?? null, text: emailBodyText(parsed) };
}

/** Create a bill from an e-mail that has no PDF, extracting fields from the e-mail text. */
async function ingestEmailText(env: Env, e: EmailContent, rawEmailKey: string): Promise<number> {
  let fields: Extracted | null = null;
  let extraction: string | null = null;
  if (e.text.replace(/\s/g, '').length >= 50) {
    try {
      const result = await extractFields(env, emailPrompt(e));
      fields = result.fields;
      extraction = JSON.stringify({ model: env.AI_MODEL, source: 'email-text', raw: result.raw });
    } catch (err) {
      extraction = JSON.stringify({ model: env.AI_MODEL, source: 'email-text', error: String(err) });
      console.error('email text extraction failed', err);
    }
  }
  const notes = fields
    ? [fields.notes, ...emailNotes(e)].filter(Boolean).join('\n')
    : 'Az e-mailben nem volt PDF melléklet, és a szövegéből sem sikerült adatot kinyerni. Nézze meg az eredeti e-mailt, és töltse ki a mezőket vagy csatolja a PDF-et.';
  return insertBill(env.DB, { source: 'email', fields, pdfKey: null, rawEmailKey, emailFrom: e.from, emailSubject: e.subject, extraction, notes });
}

function isPdfAttachment(a: { mimeType: string; filename: string | null }): boolean {
  return a.mimeType.toLowerCase() === 'application/pdf' || !!a.filename?.toLowerCase().endsWith('.pdf');
}

const GMAIL_FORWARDING_SENDER = 'forwarding-noreply@google.com';

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = await PostalMime.parse(raw);
  const headerFrom = parsed.from && 'address' in parsed.from ? parsed.from.address : undefined;

  const gmailConfirm = [message.from, headerFrom].some((a) => a?.toLowerCase() === GMAIL_FORWARDING_SENDER);
  if (!gmailConfirm && !senderAllowed(env.ALLOWED_SENDERS, [message.from, headerFrom])) {
    console.warn('rejected email from', message.from, headerFrom);
    message.setReject('Sender not allowed');
    return;
  }

  const rawEmailKey = `raw/${crypto.randomUUID()}.eml`;
  await env.FILES.put(rawEmailKey, raw, { httpMetadata: { contentType: 'message/rfc822' } });

  const emailFrom = headerFrom ?? message.from;
  const emailSubject = parsed.subject?.slice(0, 300) ?? null;
  const pdfs = parsed.attachments.filter(isPdfAttachment);

  if (gmailConfirm) {
    // Gmail's "verify forwarding address" mail: surface the code and link in the review queue.
    const text = parsed.text ?? '';
    const code = /(?:code|kód)\D{0,20}(\d{6,12})/i.exec(text)?.[1] ?? /#(\d{6,12})/.exec(emailSubject ?? '')?.[1];
    const link = /https:\/\/mail[\w.-]*\.google\.com\/\S+/.exec(text)?.[0];
    await insertBill(env.DB, {
      source: 'email',
      fields: null,
      pdfKey: null,
      rawEmailKey,
      emailFrom,
      emailSubject,
      extraction: null,
      notes: ['Gmail továbbítási megerősítés (nem számla — elutasítható).', code && `Megerősítő kód: ${code}`, link && `Link: ${link}`]
        .filter(Boolean)
        .join('\n'),
    });
    return;
  }

  if (pdfs.length === 0) {
    await ingestEmailText(env, { from: emailFrom, subject: emailSubject, text: emailBodyText(parsed) }, rawEmailKey);
    return;
  }

  for (const [i, att] of pdfs.entries()) {
    const content = att.content;
    const bytes =
      typeof content === 'string'
        ? (new TextEncoder().encode(content).buffer as ArrayBuffer)
        : content instanceof ArrayBuffer
          ? content
          : (new Uint8Array(content).buffer as ArrayBuffer);
    await ingestPdf(env, {
      bytes,
      filename: att.filename ?? `bill-${i + 1}.pdf`,
      source: 'email',
      rawEmailKey,
      emailFrom,
      emailSubject,
    });
  }
}
