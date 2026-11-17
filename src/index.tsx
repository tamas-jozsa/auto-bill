import { Hono } from 'hono';
import { requireAdmin, requireUser } from './auth';
import { handleEmail } from './intake';
import { admin } from './routes/admin';
import { files } from './routes/files';
import { tenant } from './routes/tenant';
import { createMonthlyDrafts } from './statements';
import type { AppEnv } from './types';
import { currentMonth } from './util';

const app = new Hono<AppEnv>();

app.get('/healthz', (c) => c.text('ok'));
app.use('*', requireUser);
app.use('/admin/*', requireAdmin);
app.use('/admin', requireAdmin);
app.route('/admin', admin);
app.route('/files', files);
app.route('/', tenant);

app.onError((err, c) => {
  console.error(err);
  return c.text('Something went wrong.', 500);
});

export default {
  fetch: app.fetch,

  async email(message, env) {
    await handleEmail(message, env);
  },

  async scheduled(controller, env) {
    const month = currentMonth(new Date(controller.scheduledTime));
    const created = await createMonthlyDrafts(env.DB, month);
    console.log(`created ${created} draft statement(s) for ${month}`);
  },
} satisfies ExportedHandler<Env>;
