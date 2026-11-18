import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import { getUser, getUserByEmail, run } from './db';
import type { AppEnv, User } from './types';
import { parseList } from './util';

/** Cookie holding the tenant id an admin is previewing as. Only honoured for real admins. */
export const VIEW_AS_COOKIE = 'view_as';

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function isLocalhost(url: URL): boolean {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

/**
 * Returns the authenticated email from the Cloudflare Access JWT.
 * Local dev only (`wrangler dev` on localhost with DEV_AUTH_EMAIL in .dev.vars) bypasses Access.
 */
export async function authenticatedEmail(req: Request, env: Env): Promise<string | null> {
  const url = new URL(req.url);
  const devEmail = (env as { DEV_AUTH_EMAIL?: string }).DEV_AUTH_EMAIL;
  if (devEmail && isLocalhost(url)) {
    return (req.headers.get('x-dev-email') ?? devEmail).toLowerCase();
  }

  const token = req.headers.get('cf-access-jwt-assertion');
  const aud: string = env.ACCESS_AUD;
  const team: string = env.ACCESS_TEAM_DOMAIN;
  if (!token || !aud || !team) return null;

  const issuer = `https://${team}`;
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: aud });
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch (err) {
    console.warn('invalid Access JWT', err);
    return null;
  }
}

/** Look up the user; auto-provision bootstrap admins from ADMIN_EMAILS. Banned/unknown => null. */
export async function resolveUser(env: Env, email: string): Promise<User | null> {
  let user = await getUserByEmail(env.DB, email);
  const bootstrapAdmin = parseList(env.ADMIN_EMAILS).includes(email);
  if (!user && bootstrapAdmin) {
    await run(env.DB, "INSERT INTO users (email, role) VALUES (?, 'admin') ON CONFLICT (email) DO NOTHING", email);
    user = await getUserByEmail(env.DB, email);
  } else if (user && bootstrapAdmin && (user.role !== 'admin' || user.banned)) {
    // Bootstrap admins can never lock themselves out.
    await run(env.DB, "UPDATE users SET role = 'admin', banned = 0 WHERE id = ?", user.id);
    user = { ...user, role: 'admin', banned: 0 };
  }
  if (!user || user.banned) return null;
  return user;
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Basic CSRF protection: state-changing requests must come from our own origin.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.text('Másik oldalról érkező kérés letiltva', 403);
  }
  const email = await authenticatedEmail(c.req.raw, c.env);
  if (!email) return c.text('Nincs bejelentkezve. Jelentkezzen be a Cloudflare Accessen keresztül.', 401);
  const user = await resolveUser(c.env, email);
  if (!user) return c.text(`${email} számára nincs hozzáférés. Kérjen meghívót a főbérlőtől.`, 403);
  c.set('user', user);

  // Admin "view as tenant" preview: render everything as that tenant, read-only.
  const viewAs = user.role === 'admin' ? Number(getCookie(c, VIEW_AS_COOKIE)) : 0;
  if (viewAs) {
    const target = await getUser(c.env.DB, viewAs);
    if (target && target.role === 'tenant' && !target.banned) {
      const path = new URL(c.req.url).pathname;
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && path !== '/view-as/stop') {
        return c.text('Bérlői előnézetben nem lehet módosítani. Lépjen vissza az admin nézetbe.', 403);
      }
      c.set('realUser', user);
      c.set('user', target);
    } else {
      deleteCookie(c, VIEW_AS_COOKIE, { path: '/' });
    }
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.text('Csak adminisztrátoroknak', 403);
  await next();
};
