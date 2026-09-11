import { mutationRateError } from '@/lib/mutation-guard';
import { readJsonBody } from '@/lib/http';
import { getPool } from '@/db';
import {
  clearSessionCookie,
  getAuthUser,
  hashPassword,
  isValidPassword,
  isValidPhone,
  isValidWechat,
  verifyPassword,
} from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';

export const runtime = 'nodejs';

export async function PATCH(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const rateError = await mutationRateError(request);
  if (rateError) return rateError;
  const body = await readJsonBody(request, 8192);
  if (body instanceof Response) return body;

  const passwordChange = body.action === 'password';
  if (!passwordChange && body.action !== 'profile')
    return json({ error: '不支持的操作。' }, 400);
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const wechat = typeof body.wechat === 'string' ? body.wechat.trim() : '';
  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword =
    typeof body.newPassword === 'string' ? body.newPassword : '';
  if (
    passwordChange &&
    (!isValidPassword(currentPassword) || !isValidPassword(newPassword))
  )
    return json({ error: '密码长度需为 8–128 个字符。' }, 400);
  if (passwordChange && currentPassword === newPassword)
    return json({ error: '新密码不能与当前密码相同。' }, 400);
  if (!passwordChange && (!isValidPhone(phone) || !isValidWechat(wechat)))
    return json({ error: '请输入有效的电话号码和微信号。' }, 400);

  try {
    const user = await getAuthUser(request);
    if (!user) return json({ error: '请先登录。' }, 401);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{
        password_hash: string;
        role: string;
      }>('SELECT password_hash, role FROM users WHERE id = $1 FOR UPDATE', [
        user.id,
      ]);
      // Recheck after taking the user lock: an earlier password change may have revoked this session.
      if (!(await getAuthUser(request, client))) {
        await client.query('ROLLBACK');
        return json({ error: '登录已失效，请重新登录。' }, 401);
      }
      if (locked.rows[0]?.role === 'system_admin') {
        await client.query('ROLLBACK');
        return json(
          {
            error:
              '系统管理员资料和密码由服务器配置管理，请联系服务器维护者修改。',
          },
          403,
        );
      }
      if (passwordChange) {
        if (
          !(await verifyPassword(currentPassword, locked.rows[0].password_hash))
        ) {
          await client.query('ROLLBACK');
          return json({ error: '当前密码不正确。' }, 400);
        }
        await client.query(
          'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
          [await hashPassword(newPassword), user.id],
        );
        await client.query('DELETE FROM sessions WHERE user_id = $1', [
          user.id,
        ]);
        await client.query('COMMIT');
        return Response.json(
          { message: '密码已修改，所有设备已退出登录，请使用新密码登录。' },
          {
            headers: {
              'Cache-Control': 'no-store',
              'Set-Cookie': clearSessionCookie(request),
            },
          },
        );
      }
      await client.query(
        'UPDATE users SET phone = $1, wechat = $2, contact = $3, updated_at = now() WHERE id = $4',
        [phone, wechat, `${phone} / ${wechat}`, user.id],
      );
      const updated = await getAuthUser(request, client);
      await client.query('COMMIT');
      return json({ user: updated, message: '联系方式已保存。' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Failed to update account', error);
    return json({ error: '账号更新失败，请稍后重试。' }, 500);
  }
}
