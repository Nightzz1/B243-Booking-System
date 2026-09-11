import { mutationRateError } from '@/lib/mutation-guard';
import { recordAdminAction } from '@/lib/admin-audit';
import { getAuthUser } from '@/lib/auth';
import { getPool } from '@/db';
import { json, mutationOriginError } from '@/lib/http';
import { hasSlotStarted, isDateAccessible } from '@/lib/schedule';

export const runtime = 'nodejs';

type EntryRow = {
  id: string;
  booking_date: string;
  slot_index: number;
  user_id: string | null;
  entry_type: 'booking' | 'activity' | 'lesson';
};

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const rateError = await mutationRateError(request);
  if (rateError) return rateError;

  const user = await getAuthUser(request);
  if (!user) return json({ error: '请先登录。' }, 401);

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return json({ error: '预约编号格式不正确。' }, 400);
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<EntryRow>(
      `SELECT id, booking_date::text AS booking_date, slot_index, user_id, entry_type
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const entry = result.rows[0];
    if (!entry) {
      await client.query('ROLLBACK');
      return json({ error: '该预约或活动不存在。' }, 404);
    }

    const isStarted = hasSlotStarted(entry.booking_date, entry.slot_index);
    const isSystemAdmin = user.role === 'system_admin';
    const mayDeleteActivity =
      entry.entry_type === 'activity' && user.role === 'club_admin';
    const mayDeleteOwnBooking =
      entry.entry_type === 'booking' && entry.user_id === user.id;

    if (!isDateAccessible(entry.booking_date, user.role)) {
      await client.query('ROLLBACK');
      return json({ error: '该时段不在当前账号可管理的范围内。' }, 409);
    }
    if (entry.entry_type === 'lesson') {
      await client.query('ROLLBACK');
      return json({ error: '固定鼓课请在管理设置中修改。' }, 409);
    }
    if (isStarted) {
      await client.query('ROLLBACK');
      return json({ error: '已经开始或过去的时段不能修改。' }, 409);
    }
    if (!isSystemAdmin && !mayDeleteActivity && !mayDeleteOwnBooking) {
      await client.query('ROLLBACK');
      return json({ error: '你没有取消这个时段的权限。' }, 403);
    }

    await client.query('DELETE FROM bookings WHERE id = $1', [id]);
    if (
      user.role !== 'member' &&
      (entry.entry_type === 'activity' || entry.user_id !== user.id)
    )
      await recordAdminAction(client, user.id, 'schedule.cancel', id, entry);
    await client.query('COMMIT');
    return json({ deleted: true, id });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original database error is more useful than a rollback error.
    }
    console.error('Failed to delete schedule entry', error);
    return json({ error: '取消失败，请稍后重试。' }, 500);
  } finally {
    client.release();
  }
}
