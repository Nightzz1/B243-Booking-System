import {
  canReviewUsers,
  getAuthUser,
  type UserRole,
  type UserStatus,
} from '@/lib/auth';
import { getPool } from '@/db';
import { json, mutationOriginError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ManagedUserRow = {
  id: string;
  account: string;
  display_name: string;
  phone: string;
  wechat: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  approved_at: string | null;
};

function toManagedUser(row: ManagedUserRow) {
  return {
    id: row.id,
    account: row.account,
    displayName: row.display_name,
    phone: row.phone,
    wechat: row.wechat,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

async function reviewer(request: Request) {
  const user = await getAuthUser(request);
  return user && canReviewUsers(user) ? user : null;
}

export async function GET(request: Request) {
  try {
    const user = await reviewer(request);
    if (!user) return json({ error: '没有账号审核权限。' }, 403);

    const result = await getPool().query<ManagedUserRow>(
      `SELECT id, account, display_name,
              COALESCE(phone, contact) AS phone,
              COALESCE(wechat, contact) AS wechat,
              role, status,
              created_at::text AS created_at, approved_at::text AS approved_at
       FROM users
       WHERE role <> 'system_admin'
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                created_at DESC`,
    );
    return json({ users: result.rows.map(toManagedUser) });
  } catch (error) {
    console.error('Failed to load managed users', error);
    return json({ error: '用户列表暂时无法加载。' }, 500);
  }
}

export async function PATCH(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  let body: { userId?: unknown; action?: unknown; role?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  const userId = typeof body.userId === 'string' ? body.userId : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return json({ error: '用户编号格式不正确。' }, 400);
  }

  try {
    const actor = await reviewer(request);
    if (!actor) return json({ error: '没有账号审核权限。' }, 403);

    const targetResult = await getPool().query<{
      id: string;
      role: UserRole;
      status: UserStatus;
    }>('SELECT id, role, status FROM users WHERE id = $1', [userId]);
    const target = targetResult.rows[0];
    if (!target) return json({ error: '用户不存在。' }, 404);
    if (target.role === 'system_admin') {
      return json({ error: '系统管理员账号不能在这里修改。' }, 403);
    }
    if (actor.role === 'club_admin' && target.role !== 'member') {
      return json({ error: '鼓房管理员只能审核普通社员账号。' }, 403);
    }

    if (action === 'approve') {
      await getPool().query(
        `UPDATE users
         SET status = 'approved', approved_by = $1, approved_at = now(), updated_at = now()
         WHERE id = $2`,
        [actor.id, userId],
      );
    } else if (action === 'reject') {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE users
           SET status = 'rejected', approved_by = $1, approved_at = now(), updated_at = now()
           WHERE id = $2`,
          [actor.id, userId],
        );
        await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else if (action === 'set_role') {
      if (actor.role !== 'system_admin') {
        return json({ error: '只有系统管理员可以设置账号身份。' }, 403);
      }
      if (body.role !== 'member' && body.role !== 'club_admin') {
        return json({ error: '账号身份不正确。' }, 400);
      }
      await getPool().query(
        `UPDATE users
         SET role = $1, status = 'approved', approved_by = $2,
             approved_at = COALESCE(approved_at, now()), updated_at = now()
         WHERE id = $3`,
        [body.role, actor.id, userId],
      );
    } else {
      return json({ error: '不支持的管理操作。' }, 400);
    }

    const updated = await getPool().query<ManagedUserRow>(
      `SELECT id, account, display_name,
              COALESCE(phone, contact) AS phone,
              COALESCE(wechat, contact) AS wechat,
              role, status,
              created_at::text AS created_at, approved_at::text AS approved_at
       FROM users WHERE id = $1`,
      [userId],
    );
    return json({ user: toManagedUser(updated.rows[0]) });
  } catch (error) {
    console.error('Failed to update managed user', error);
    return json({ error: '账号更新失败，请稍后重试。' }, 500);
  }
}
