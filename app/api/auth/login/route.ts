import {
  createSession,
  ensureSystemAdmin,
  normalizeAccount,
  isValidAccount,
  isValidPassword,
  sessionCookie,
  verifyPassword,
  type AuthUser,
  type UserRole,
  type UserStatus,
} from '@/lib/auth';
import { getPool } from '@/db';
import {
  limitAuthIp,
  reserveLoginAttempt,
  releaseLoginAttempt,
  type LoginAttempt,
} from '@/lib/auth-rate-limit';
import { json, mutationOriginError, readAuthJson } from '@/lib/http';

export const runtime = 'nodejs';

type LoginRow = {
  id: string;
  account: string;
  password_hash: string;
  display_name: string;
  phone: string;
  wechat: string;
  role: UserRole;
  status: UserStatus;
};

function publicUser(row: LoginRow): AuthUser {
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

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  try {
    const limited = await limitAuthIp(request, 'login');
    if (limited) return limited;
  } catch (error) {
    console.error('Login rate limiter unavailable', error);
    return json({ error: '登录服务暂时不可用，请稍后重试。' }, 503);
  }
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;

  const account =
    typeof body.account === 'string' ? normalizeAccount(body.account) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isValidAccount(account) || !isValidPassword(password)) {
    return json(
      { error: '请输入有效的学号/工号和密码（密码需为 8–128 个字符）。' },
      400,
    );
  }

  let attempt: LoginAttempt | undefined;
  try {
    const reservation = await reserveLoginAttempt(account);
    if (reservation instanceof Response) return reservation;
    attempt = reservation;
    await ensureSystemAdmin();
    const result = await getPool().query<LoginRow>(
      `SELECT id, account, password_hash, display_name,
              COALESCE(phone, contact) AS phone,
              COALESCE(wechat, contact) AS wechat,
              role, status
       FROM users
       WHERE account = $1
       LIMIT 1`,
      [account],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      attempt = undefined; // Failed credentials keep their reserved budget.
      return json({ error: '账号或密码不正确。' }, 401);
    }
    await releaseLoginAttempt(attempt);
    attempt = undefined;
    if (user.status === 'pending') {
      return json({ error: '账号正在等待管理员审核。' }, 403);
    }
    if (user.status === 'rejected') {
      return json({ error: '注册申请未通过，请联系管理员。' }, 403);
    }

    const session = await createSession(user.id, user.password_hash);
    if (!session)
      return json({ error: '账号状态或密码已变更，请重新登录。' }, 401);
    return Response.json(
      { user: publicUser(user) },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': sessionCookie(
            request,
            session.token,
            session.cookieExpiresAt,
          ),
        },
      },
    );
  } catch (error) {
    if (attempt) await releaseLoginAttempt(attempt).catch(() => {});
    console.error('Failed to log in', error);
    return json({ error: '登录暂时失败，请稍后重试。' }, 500);
  }
}
