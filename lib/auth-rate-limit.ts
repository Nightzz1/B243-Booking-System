import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { getPool } from '@/db';

type Rule = { limit: number; windowSeconds: number; cooldownSeconds: number };
export type LoginAttempt = { key: string; generation: string };
type Bucket = { generation: string; retry_after: number };

function setting(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 86400)
    throw new Error(`Invalid ${name}`);
  return parsed;
}

export function rateLimitResponse(seconds: number, account = false) {
  const retryAfter = Math.max(1, Math.ceil(seconds));
  return Response.json(
    {
      error: `${account ? '该账号登录尝试过于频繁' : '当前网络请求过于频繁'}，请在 ${retryAfter} 秒后重试。`,
      retryAfter,
    },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter),
      },
    },
  );
}

// Only trust a header overwritten by our reverse proxy, never arbitrary X-Forwarded-For.
export function clientIpKey(request: Request) {
  if (process.env.AUTH_TRUST_PROXY !== 'true') return 'local-development';
  const raw = request.headers.get('x-booking-client-ip')?.trim();
  if (!raw || !isIP(raw))
    throw new Error('Trusted client IP header missing or invalid');
  if (isIP(raw) === 4) return raw;
  // URL normalizes compressed/expanded IPv6 and IPv4-mapped representations.
  const normalized = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  const [head, tail] = normalized.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail !== undefined
      ? [
          ...left,
          ...Array<string>(8 - left.length - right.length).fill('0'),
          ...right,
        ]
      : left;
  const values = groups.map((group) => parseInt(group, 16));
  if (values.slice(0, 5).every((part) => part === 0) && values[5] === 65535) {
    return `${values[6] >> 8}.${values[6] & 255}.${values[7] >> 8}.${values[7] & 255}`;
  }
  // IPv6 privacy addresses from the same /64 share a budget.
  return `${values
    .slice(0, 4)
    .map((part) => part.toString(16))
    .join(':')}::/64`;
}

let nextCleanupAt = 0;
async function cleanup() {
  if (Date.now() < nextCleanupAt) return;
  nextCleanupAt = Date.now() + 5 * 60_000;
  try {
    await getPool().query(`DELETE FROM auth_rate_limits WHERE key IN (
      SELECT key FROM auth_rate_limits WHERE expires_at <= now()
        AND (blocked_until IS NULL OR blocked_until <= now()) LIMIT 1000
    )`);
  } catch (error) {
    nextCleanupAt = 0;
    throw error;
  }
}

async function consume(
  scope: string,
  identity: string,
  rule: Rule,
): Promise<LoginAttempt | Response> {
  await cleanup();
  const key = createHash('sha256').update(`${scope}:${identity}`).digest('hex');
  // Each request reserves a slot atomically. Active cooldowns are never extended by retries.
  const result = await getPool().query<Bucket>(
    `INSERT INTO auth_rate_limits AS bucket (key, generation, hits, expires_at)
     VALUES ($1, $2::uuid, 1, now() + $4 * interval '1 second')
     ON CONFLICT (key) DO UPDATE SET
       generation = CASE
         WHEN bucket.blocked_until > now() THEN bucket.generation
         WHEN bucket.expires_at <= now() OR bucket.blocked_until <= now() THEN EXCLUDED.generation
         ELSE bucket.generation END,
       hits = CASE
         WHEN bucket.blocked_until > now() THEN bucket.hits
         WHEN bucket.expires_at <= now() OR bucket.blocked_until <= now() THEN 1
         ELSE LEAST(bucket.hits + 1, $3 + 1) END,
       expires_at = CASE
         WHEN bucket.blocked_until > now() THEN bucket.expires_at
         WHEN bucket.expires_at <= now() OR bucket.blocked_until <= now() THEN EXCLUDED.expires_at
         ELSE bucket.expires_at END,
       blocked_until = CASE
         WHEN bucket.blocked_until > now() THEN bucket.blocked_until
         WHEN bucket.expires_at <= now() OR bucket.blocked_until <= now() THEN NULL
         WHEN bucket.hits >= $3 THEN now() + $5 * interval '1 second'
         ELSE NULL END
     RETURNING generation, COALESCE(CEIL(EXTRACT(EPOCH FROM (blocked_until - now())))::integer, 0) AS retry_after`,
    [key, randomUUID(), rule.limit, rule.windowSeconds, rule.cooldownSeconds],
  );
  const bucket = result.rows[0];
  return bucket.retry_after > 0
    ? rateLimitResponse(bucket.retry_after, scope === 'login-account')
    : { key, generation: bucket.generation };
}

export async function limitAuthIp(
  request: Request,
  kind: 'login' | 'register',
) {
  const rule =
    kind === 'login'
      ? {
          limit: setting('AUTH_LOGIN_IP_LIMIT', 120),
          windowSeconds: 60,
          cooldownSeconds: setting('AUTH_LOGIN_IP_COOLDOWN_SECONDS', 60),
        }
      : {
          limit: setting('AUTH_REGISTER_IP_LIMIT', 30),
          windowSeconds: 600,
          cooldownSeconds: setting('AUTH_REGISTER_IP_COOLDOWN_SECONDS', 120),
        };
  const result = await consume(`${kind}-ip`, clientIpKey(request), rule);
  return result instanceof Response ? result : null;
}

export function reserveLoginAttempt(account: string) {
  return consume('login-account', account, {
    limit: setting('AUTH_LOGIN_ACCOUNT_LIMIT', 8),
    windowSeconds: 600,
    cooldownSeconds: setting('AUTH_LOGIN_ACCOUNT_COOLDOWN_SECONDS', 120),
  });
}

// Successful password checks and server errors release only their own reservation.
// The generation guards against late completions touching a newer window.
export async function releaseLoginAttempt(attempt: LoginAttempt) {
  await getPool().query(
    'UPDATE auth_rate_limits SET hits = GREATEST(0, hits - 1) WHERE key = $1 AND generation = $2::uuid',
    [attempt.key, attempt.generation],
  );
}

export async function limitSensitiveMutation(
  request: Request,
  userId: string,
  credential = false,
) {
  const scope = credential ? 'credential-write' : 'business-write';
  const account = await consume(scope, userId, {
    limit: setting(
      credential ? 'WRITE_CREDENTIAL_LIMIT' : 'WRITE_ACCOUNT_LIMIT',
      credential ? 10 : 60,
    ),
    windowSeconds: credential ? 600 : 60,
    cooldownSeconds: 60,
  });
  if (account instanceof Response) return account;
  if (process.env.AUTH_TRUST_PROXY === 'true') {
    const ip = await consume('business-write-ip', clientIpKey(request), {
      limit: setting('WRITE_IP_LIMIT', 600),
      windowSeconds: 60,
      cooldownSeconds: 60,
    });
    if (ip instanceof Response) return ip;
  }
  return null;
}
