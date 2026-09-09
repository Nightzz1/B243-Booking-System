import {
  createSession,
  ensureSystemAdmin,
  normalizeAccount,
  sessionCookie,
  verifyPassword,
  type AuthUser,
  type UserRole,
  type UserStatus,
} from '@/lib/auth';
import { getPool } from '@/db';
import { json, mutationOriginError } from '@/lib/http';

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

  let body: { account?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  const account =
    typeof body.account === 'string' ? normalizeAccount(body.account) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!account || !password) {
    return json({ error: '请输入学号/工号和密码。' }, 400);
  }

  try {
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
      return json({ error: '账号或密码不正确。' }, 401);
    }
    if (user.status === 'pending') {
      return json({ error: '账号正在等待管理员审核。' }, 403);
    }
    if (user.status === 'rejected') {
      return json({ error: '注册申请未通过，请联系管理员。' }, 403);
    }

    const session = await createSession(user.id);
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
    console.error('Failed to log in', error);
    return json({ error: '登录暂时失败，请稍后重试。' }, 500);
  }
}
