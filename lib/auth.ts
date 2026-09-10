import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';

import { getPool } from '@/db';

export const SESSION_COOKIE_NAME = 'drum_room_session';
const PASSWORD_PREFIX = 'scrypt-v1';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const ROTATED_TOKEN_GRACE_MS = 5 * 60_000;

export type UserRole = 'system_admin' | 'club_admin' | 'member';
export type UserStatus = 'pending' | 'approved' | 'rejected';

export type AuthUser = {
  id: string;
  account: string;
  displayName: string;
  phone: string;
  wechat: string;
  role: UserRole;
  status: UserStatus;
};

type UserRow = {
  id: string;
  account: string;
  display_name: string;
  phone: string;
  wechat: string;
  role: UserRole;
  status: UserStatus;
};

type SessionRow = UserRow & {
  session_id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  has_successor: boolean;
};

type SessionConfig = {
  idleDays: number;
  absoluteDays: number;
  renewBeforeHours: number;
};

export type RefreshedAuthSession = {
  user: AuthUser;
  renewal?: {
    token: string;
    cookieExpiresAt: Date;
  };
};

function integerEnvironmentValue(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${minimum}–${maximum} 之间的整数`);
  }
  return value;
}

export function getSessionConfig(): SessionConfig {
  const idleDays = integerEnvironmentValue('SESSION_IDLE_TTL_DAYS', 7, 1, 30);
  const absoluteDays = integerEnvironmentValue(
    'SESSION_ABSOLUTE_TTL_DAYS',
    30,
    1,
    365,
  );
  const renewBeforeHours = integerEnvironmentValue(
    'SESSION_RENEW_BEFORE_HOURS',
    24,
    1,
    719,
  );

  if (absoluteDays < idleDays) {
    throw new Error('SESSION_ABSOLUTE_TTL_DAYS 不能小于 SESSION_IDLE_TTL_DAYS');
  }
  if (renewBeforeHours >= idleDays * 24) {
    throw new Error('SESSION_RENEW_BEFORE_HOURS 必须小于闲置有效期');
  }
  return { idleDays, absoluteDays, renewBeforeHours };
}

export function normalizeAccount(value: string) {
  return value.trim().toLowerCase();
}

export function isValidAccount(value: string) {
  return /^[a-z0-9_-]{3,32}$/.test(value);
}

export function isValidPassword(value: string) {
  return (
    value.length >= 8 && value.length <= 128 && Buffer.byteLength(value) <= 256
  );
}

export function isValidPhone(value: string) {
  return (
    value.length >= 6 &&
    value.length <= 32 &&
    /^[0-9+() -]+$/.test(value) &&
    (value.match(/\d/g)?.length ?? 0) >= 6
  );
}

export function isValidWechat(value: string) {
  return value.length >= 1 && value.length <= 64;
}

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return `${PASSWORD_PREFIX}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [prefix, saltValue, hashValue] = encoded.split('$');
  if (prefix !== PASSWORD_PREFIX || !saltValue || !hashValue) return false;

  try {
    const expected = Buffer.from(hashValue, 'base64url');
    const actual = await derivePassword(
      password,
      Buffer.from(saltValue, 'base64url'),
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(request: Request) {
  const values = new Map<string, string>();
  for (const item of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name) values.set(name, decodeURIComponent(value));
  }
  return values;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    account: row.account,
    displayName: row.display_name,
    phone: row.phone,
    wechat: row.wechat,
    role: row.role,
    status: row.status,
  };
}

export async function ensureSystemAdmin() {
  const rawAccount = process.env.SYSTEM_ADMIN_ACCOUNT ?? '';
  const password = process.env.SYSTEM_ADMIN_PASSWORD ?? '';
  if (!rawAccount && !password) return;

  const account = normalizeAccount(rawAccount);
  if (!isValidAccount(account) || !isValidPassword(password)) {
    throw new Error('SYSTEM_ADMIN_ACCOUNT 或 SYSTEM_ADMIN_PASSWORD 配置无效');
  }

  const displayName = (process.env.SYSTEM_ADMIN_NAME ?? '系统管理员')
    .trim()
    .slice(0, 40);
  const contact = (process.env.SYSTEM_ADMIN_CONTACT ?? '仅限系统维护')
    .trim()
    .slice(0, 100);
  const phone = (process.env.SYSTEM_ADMIN_PHONE ?? contact).trim().slice(0, 32);
  const wechat = (process.env.SYSTEM_ADMIN_WECHAT ?? contact)
    .trim()
    .slice(0, 64);
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const existing = await client.query<{
      id: string;
      account: string;
      password_hash: string;
    }>(
      `SELECT id, account, password_hash
       FROM users
       WHERE role = 'system_admin'
       FOR UPDATE`,
    );

    const passwordHash =
      existing.rows[0] &&
      (await verifyPassword(password, existing.rows[0].password_hash))
        ? existing.rows[0].password_hash
        : await hashPassword(password);

    if (existing.rows[0]) {
      await client.query(
        `UPDATE users
         SET account = $1, password_hash = $2, display_name = $3, contact = $4,
             phone = $5, wechat = $6,
             status = 'approved', approved_at = COALESCE(approved_at, now()),
             updated_at = now()
         WHERE id = $7`,
        [
          account,
          passwordHash,
          displayName,
          contact,
          phone,
          wechat,
          existing.rows[0].id,
        ],
      );
    } else {
      const conflicting = await client.query<{ id: string }>(
        'SELECT id FROM users WHERE account = $1 FOR UPDATE',
        [account],
      );
      if (conflicting.rows[0]) {
        await client.query(
          `UPDATE users
           SET password_hash = $1, display_name = $2, contact = $3,
               phone = $4, wechat = $5,
               role = 'system_admin', status = 'approved', approved_at = now(),
               updated_at = now()
           WHERE id = $6`,
          [
            passwordHash,
            displayName,
            contact,
            phone,
            wechat,
            conflicting.rows[0].id,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO users
             (id, account, password_hash, display_name, contact, phone, wechat,
              role, status, approved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7,
                   'system_admin', 'approved', now())`,
          [
            crypto.randomUUID(),
            account,
            passwordHash,
            displayName,
            contact,
            phone,
            wechat,
          ],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getAuthUser(
  request: Request,
  connection: Pick<PoolClient, 'query'> = getPool(),
) {
  const token = parseCookies(request).get(SESSION_COOKIE_NAME);
  if (!token) return null;

  const { absoluteDays } = getSessionConfig();

  const result = await connection.query<UserRow>(
    `SELECT u.id, u.account, u.display_name,
            COALESCE(u.phone, u.contact) AS phone,
            COALESCE(u.wechat, u.contact) AS wechat,
            u.role, u.status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()
       AND s.created_at > now() - ($2::integer * interval '1 day')
       AND u.status = 'approved'
     LIMIT 1`,
    [tokenHash(token), absoluteDays],
  );
  return result.rows[0] ? toAuthUser(result.rows[0]) : null;
}

export async function createSession(
  userId: string,
  expectedPasswordHash: string,
) {
  const { idleDays, absoluteDays } = getSessionConfig();
  const createdAt = new Date();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(createdAt.getTime() + idleDays * DAY_MS);
  const cookieExpiresAt = new Date(createdAt.getTime() + absoluteDays * DAY_MS);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      "SELECT id FROM users WHERE id = $1 AND password_hash = $2 AND status = 'approved' FOR UPDATE",
      [userId, expectedPasswordHash],
    );
    if (!user.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('DELETE FROM sessions WHERE expires_at <= now()');
    await client.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), userId, tokenHash(token), expiresAt, createdAt],
    );
    await client.query('COMMIT');
    return { token, cookieExpiresAt };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshAuthSession(
  request: Request,
): Promise<RefreshedAuthSession | null> {
  const token = parseCookies(request).get(SESSION_COOKIE_NAME);
  if (!token) return null;

  const config = getSessionConfig();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Keep the lock order user -> session consistent with password changes.
    await client.query(
      `SELECT u.id FROM users u JOIN sessions s ON s.user_id = u.id
       WHERE s.token_hash = $1 FOR UPDATE OF u`,
      [tokenHash(token)],
    );
    const result = await client.query<SessionRow>(
      `SELECT s.id AS session_id, s.user_id,
              s.expires_at::text AS expires_at,
              s.created_at::text AS created_at,
              EXISTS (
                SELECT 1 FROM sessions successor
                WHERE successor.user_id = s.user_id
                  AND successor.created_at = s.created_at
                  AND successor.id <> s.id
                  AND successor.expires_at > s.expires_at
              ) AS has_successor,
              u.id, u.account, u.display_name,
              COALESCE(u.phone, u.contact) AS phone,
              COALESCE(u.wechat, u.contact) AS wechat,
              u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
         AND s.created_at > now() - ($2::integer * interval '1 day')
         AND u.status = 'approved'
       LIMIT 1
       FOR UPDATE OF s`,
      [tokenHash(token), config.absoluteDays],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const user = toAuthUser(row);
    const now = Date.now();
    const createdAt = new Date(row.created_at);
    const expiresAt = new Date(row.expires_at);
    const absoluteExpiresAt = new Date(
      createdAt.getTime() + config.absoluteDays * DAY_MS,
    );
    if (row.has_successor) {
      await client.query('COMMIT');
      return { user };
    }
    if (expiresAt.getTime() - now > config.renewBeforeHours * HOUR_MS) {
      await client.query('COMMIT');
      return { user };
    }

    const renewedToken = randomBytes(32).toString('base64url');
    const renewedExpiresAt = new Date(
      Math.min(now + config.idleDays * DAY_MS, absoluteExpiresAt.getTime()),
    );
    const oldTokenGraceExpiresAt = new Date(
      Math.min(now + ROTATED_TOKEN_GRACE_MS, absoluteExpiresAt.getTime()),
    );

    await client.query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [
      oldTokenGraceExpiresAt,
      row.session_id,
    ]);
    await client.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        row.user_id,
        tokenHash(renewedToken),
        renewedExpiresAt,
        row.created_at,
      ],
    );
    await client.query('DELETE FROM sessions WHERE expires_at <= now()');
    await client.query('COMMIT');
    return {
      user,
      renewal: {
        token: renewedToken,
        cookieExpiresAt: absoluteExpiresAt,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteSession(request: Request) {
  const token = parseCookies(request).get(SESSION_COOKIE_NAME);
  if (!token) return;
  await getPool().query(
    `WITH target AS (
       SELECT user_id, created_at FROM sessions WHERE token_hash = $1
     )
     DELETE FROM sessions s
     USING target t
     WHERE s.user_id = t.user_id AND s.created_at = t.created_at`,
    [tokenHash(token)],
  );
}

function shouldUseSecureCookie(request: Request) {
  if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  return (
    forwardedProtocol === 'https' || new URL(request.url).protocol === 'https:'
  );
}

export function sessionCookie(
  request: Request,
  token: string,
  expiresAt: Date,
) {
  const secure = shouldUseSecureCookie(request) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = shouldUseSecureCookie(request) ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function canReviewUsers(user: AuthUser) {
  return user.role === 'system_admin' || user.role === 'club_admin';
}

export function canManageActivities(user: AuthUser) {
  return user.role === 'system_admin' || user.role === 'club_admin';
}
