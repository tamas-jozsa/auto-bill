import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { requireAdmin, requireUser, VIEW_AS_COOKIE } from './auth';
import { handleEmail } from './intake';
import { admin } from './routes/admin';
import { files } from './routes/files';
import { tenant } from './routes/tenant';
import { createMonthlyDrafts, runAutoStatements } from './statements';
import type { AppEnv } from './types';
import { currentMonth } from './util';

const app = new Hono<AppEnv>();

app.get('/healthz', (c) => c.text('ok'));
app.use('*', requireUser);
app.post('/view-as/stop', (c) => {
  deleteCookie(c, VIEW_AS_COOKIE, { path: '/' });
  return c.redirect('/', 303);
});
app.use('/admin/*', requireAdmin);
app.use('/admin', requireAdmin);
app.route('/admin', admin);
app.route('/files', files);
app.route('/', tenant);

app.onError((err, c) => {
  console.error(err);
  return c.text('Hiba történt.', 500);
});

export default {
  fetch: app.fetch,

  async email(message, env) {
    await handleEmail(message, env);
  },

  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);
    const auto = await runAutoStatements(env.DB, now);
    console.log(`automatic statements: ${auto.sent} sent, ${auto.skipped} empty`);
    if (now.getUTCDate() === 10) {
      const month = currentMonth(now);
      const created = await createMonthlyDrafts(env.DB, month);
      console.log(`created ${created} draft statement(s) for ${month}`);
    }
  },
} satisfies ExportedHandler<Env>;
