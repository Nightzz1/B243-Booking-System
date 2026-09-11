import { mutationRateError } from '@/lib/mutation-guard';
import { readJsonBody } from '@/lib/http';
import { recordAdminAction } from '@/lib/admin-audit';
import { canManageActivities, getAuthUser, type AuthUser } from '@/lib/auth';
import { getPool } from '@/db';
import { json, mutationOriginError } from '@/lib/http';
import {
  getBookingPolicy,
  hasSlotStarted,
  isDateAccessible,
  isRealDate,
  type BookingPolicy,
  slotForDate,
  SLOT_COUNT,
} from '@/lib/schedule';

export const runtime = 'nodejs';

type RequestedSlot = { date: string; slotIndex: number };

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const rateError = await mutationRateError(request);
  if (rateError) return rateError;

  const body = await readJsonBody(request, 8192);
  if (body instanceof Response) return body;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 80) {
    return json({ error: '活动名称需为 1–80 个字符。' }, 400);
  }
  if (
    !Array.isArray(body.slots) ||
    body.slots.length === 0 ||
    body.slots.length > 20
  ) {
    return json({ error: '请选择 1–20 个活动时段。' }, 400);
  }

  let user: AuthUser | null;
  let policy: BookingPolicy;
  try {
    [user, policy] = await Promise.all([
      getAuthUser(request),
      getBookingPolicy(),
    ]);
  } catch (error) {
    console.error('Failed to authorize activity request', error);
    return json({ error: '活动权限检查失败，请稍后重试。' }, 500);
  }
  if (!user || !canManageActivities(user)) {
    return json({ error: '没有登记社团活动的权限。' }, 403);
  }

  const slots: RequestedSlot[] = [];
  const seen = new Set<string>();
  for (const item of body.slots) {
    if (!item || typeof item !== 'object') {
      return json({ error: '活动时段格式不正确。' }, 400);
    }
    const value = item as { date?: unknown; slotIndex?: unknown };
    if (
      typeof value.date !== 'string' ||
      !isRealDate(value.date) ||
      !Number.isInteger(value.slotIndex) ||
      (value.slotIndex as number) < 0 ||
      (value.slotIndex as number) >= SLOT_COUNT
    ) {
      return json({ error: '活动时段格式不正确。' }, 400);
    }
    const slotIndex = value.slotIndex as number;
    if (!isDateAccessible(value.date, user.role)) {
      return json({ error: '只能管理前三周至未来 16 周范围内的活动。' }, 400);
    }
    const scheduleSlot = slotForDate(value.date, slotIndex, policy);
    if (!scheduleSlot) {
      return json({ error: '所选节次不在当天的预约表中。' }, 400);
    }
    if (scheduleSlot.isPublic) {
      return json(
        {
          error: '学期内周一至周五的第三节至第六节为公用时段，不能登记活动。',
        },
        409,
      );
    }
    if (hasSlotStarted(value.date, slotIndex)) {
      return json({ error: '不能登记已经开始或过去的活动时段。' }, 400);
    }
    const key = `${value.date}|${slotIndex}`;
    if (seen.has(key)) return json({ error: '活动时段不能重复。' }, 400);
    seen.add(key);
    slots.push({ date: value.date, slotIndex });
  }

  slots.sort(
    (a, b) => a.date.localeCompare(b.date) || a.slotIndex - b.slotIndex,
  );
  try {
    const placeholders = slots
      .map(
        (_, index) =>
          `($${index * 5 + 1}::uuid, $${index * 5 + 2}::date, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5}::uuid, 'activity')`,
      )
      .join(', ');
    const values = slots.flatMap((slot) => [
      crypto.randomUUID(),
      slot.date,
      slot.slotIndex,
      title,
      user.id,
    ]);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO bookings
         (id, booking_date, slot_index, member_name, user_id, entry_type)
       VALUES ${placeholders}
       RETURNING id`,
        values,
      );
      await recordAdminAction(client, user.id, 'activity.create', title, {
        slots,
      });
      await client.query('COMMIT');
      return json({ count: result.rowCount ?? slots.length }, 201);
    } finally {
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === '23505' || code === '23P01' || code === '40P01') {
      return json(
        { error: '部分时段已被预约、活动或固定鼓课占用，请重新选择。' },
        409,
      );
    }
    console.error('Failed to create activity', error);
    return json({ error: '活动登记失败，请稍后重试。' }, 500);
  }
}
