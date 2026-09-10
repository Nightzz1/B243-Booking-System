import { randomBytes } from 'node:crypto';
import { getPool } from '@/db';
import { getAuthUser, hashPassword } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const { id } = await context.params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return json({ error: '用户编号格式不正确。' }, 400);
  try {
    const actor = await getAuthUser(request);
    if (!actor || actor.role !== 'system_admin')
      return json({ error: '只有系统管理员可以重置密码。' }, 403);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // Deterministic lock order also serializes resets with password changes and logins.
      await client.query(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [[actor.id, id]],
      );
      const currentActor = await getAuthUser(request, client);
      if (!currentActor || currentActor.role !== 'system_admin') {
        await client.query('ROLLBACK');
        return json({ error: '管理员登录已失效。' }, 403);
      }
      const target = await client.query<{ role: string; status: string }>(
        'SELECT role, status FROM users WHERE id = $1',
        [id],
      );
      if (
        !target.rows[0] ||
        target.rows[0].role === 'system_admin' ||
        target.rows[0].status !== 'approved'
      ) {
        await client.query('ROLLBACK');
        return json({ error: '只能重置已审核社员或鼓房管理员的密码。' }, 400);
      }
      const newPassword = randomBytes(18).toString('base64url');
      await client.query(
        'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
        [await hashPassword(newPassword), id],
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await client.query('COMMIT');
      return json({ newPassword });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to reset user password', error);
    return json({ error: '重置失败，请稍后重试。' }, 500);
  }
}
