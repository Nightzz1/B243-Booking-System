import { getAuthUser, type AuthUser } from '@/lib/auth';
import { getPool } from '@/db';
import { json, mutationOriginError } from '@/lib/http';
import {
  accessibleScheduleRange,
  addDateDays,
  type BookingPolicy,
  getBookingPolicy,
  hasSlotStarted,
  isDateAccessible,
  isBookingOpen,
  isRealDate,
  scheduleDay,
  slotForDate,
  SLOT_COUNT,
  weekRange,
} from '@/lib/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EntryType = 'booking' | 'activity' | 'lesson';

type BookingRow = {
  id: string;
  booking_date: string;
  slot_index: number;
  member_name: string;
  user_id: string | null;
  entry_type: EntryType;
  lesson_id: string | null;
  created_at: string;
  phone?: string | null;
  wechat?: string | null;
};

type RequestedSlot = {
  date: string;
  slotIndex: number;
};

function canCancelEntry(row: BookingRow, user: AuthUser) {
  if (hasSlotStarted(row.booking_date, row.slot_index)) return false;
  if (row.entry_type === 'lesson') return false;
  if (user.role === 'system_admin') return true;
  if (row.entry_type === 'activity') return user.role === 'club_admin';
  return row.user_id === user.id;
}

function toBooking(row: BookingRow, user: AuthUser) {
  const isOwn = row.user_id === user.id;
  return {
    id: row.id,
    date: row.booking_date,
    slotIndex: row.slot_index,
    memberName: row.member_name,
    entryType: row.entry_type,
    lessonId: row.lesson_id,
    createdAt: row.created_at,
    isOwn,
    canCancel: canCancelEntry(row, user),
    contact:
      row.entry_type === 'booking' && !isOwn && row.phone && row.wechat
        ? { phone: row.phone, wechat: row.wechat }
        : null,
  };
}

async function findRequestedBookings(slots: RequestedSlot[], user: AuthUser) {
  const predicate = slots
    .map(
      (_, index) =>
        `(b.booking_date = $${index * 2 + 1}::date AND b.slot_index = $${index * 2 + 2})`,
    )
    .join(' OR ');
  const values = slots.flatMap((slot) => [slot.date, slot.slotIndex]);
  const result = await getPool().query<BookingRow>(
    `SELECT b.id, b.booking_date::text AS booking_date, b.slot_index,
            b.member_name, b.user_id, b.entry_type, b.lesson_id,
            b.created_at::text AS created_at,
            COALESCE(u.phone, u.contact) AS phone,
            COALESCE(u.wechat, u.contact) AS wechat
     FROM bookings b
     LEFT JOIN users u ON u.id = b.user_id
     WHERE ${predicate}
     ORDER BY b.booking_date, b.slot_index`,
    values,
  );
  return result.rows.map((row) => toBooking(row, user));
}

function validateSlots(
  value: unknown,
  policy: BookingPolicy,
): RequestedSlot[] | Response {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) {
    return json({ error: '每次请选择 1–2 个预约时段。' }, 400);
  }

  const slots: RequestedSlot[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return json({ error: '预约时段格式不正确。' }, 400);
    }
    const candidate = item as { date?: unknown; slotIndex?: unknown };
    if (
      typeof candidate.date !== 'string' ||
      !isRealDate(candidate.date) ||
      !Number.isInteger(candidate.slotIndex) ||
      (candidate.slotIndex as number) < 0 ||
      (candidate.slotIndex as number) >= SLOT_COUNT
    ) {
      return json({ error: '预约时段格式不正确。' }, 400);
    }
    const slotIndex = candidate.slotIndex as number;
    if (!isDateAccessible(candidate.date)) {
      return json({ error: '只能预约本周、前三周和后两周范围内的时段。' }, 400);
    }
    const scheduleSlot = slotForDate(candidate.date, slotIndex, policy);
    if (!scheduleSlot) {
      return json({ error: '所选节次不在当天的预约表中。' }, 400);
    }
    if (scheduleSlot.isPublic) {
      return json(
        {
          error: '学期内周一至周五的第三节至第六节为公用时段，不开放预约。',
        },
        409,
      );
    }
    if (!isBookingOpen(candidate.date)) {
      return json(
        {
          error: `该日期尚未开放预约，将于 ${scheduleDay(candidate.date, policy).bookingOpenDate} 13:00 开放。`,
        },
        409,
      );
    }
    if (hasSlotStarted(candidate.date, slotIndex)) {
      return json({ error: '不能预约已经开始或过去的时段。' }, 400);
    }
    const key = `${candidate.date}|${slotIndex}`;
    if (seen.has(key)) return json({ error: '预约时段不能重复。' }, 400);
    seen.add(key);
    slots.push({ date: candidate.date, slotIndex });
  }
  return slots;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return json({ error: '请先登录后查看预约表。' }, 401);

    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!isRealDate(from) || !isRealDate(to) || from > to) {
      return json({ error: '请提供有效的起止日期。' }, 400);
    }
    const rangeDays =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    if (rangeDays > 31) {
      return json({ error: '一次最多查询 32 天的预约。' }, 400);
    }
    const accessibleRange = accessibleScheduleRange();
    if (from < accessibleRange.from || to > accessibleRange.to) {
      return json({ error: '只能查看本周、前三周和后两周的预约。' }, 400);
    }

    const policy = await getBookingPolicy();
    const quotaWeek = weekRange(from);
    const [bookingResult, countResult] = await Promise.all([
      getPool().query<BookingRow>(
        `SELECT b.id, b.booking_date::text AS booking_date, b.slot_index,
                b.member_name, b.user_id, b.entry_type, b.lesson_id,
                b.created_at::text AS created_at,
                COALESCE(u.phone, u.contact) AS phone,
                COALESCE(u.wechat, u.contact) AS wechat
         FROM bookings b
         LEFT JOIN users u ON u.id = b.user_id
         WHERE b.booking_date >= $1::date AND b.booking_date <= $2::date
         ORDER BY b.booking_date, b.slot_index`,
        [from, to],
      ),
      getPool().query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM bookings
         WHERE user_id = $1 AND entry_type = 'booking'
           AND booking_date BETWEEN $2::date AND $3::date`,
        [user.id, quotaWeek.from, quotaWeek.to],
      ),
    ]);

    return json({
      bookings: bookingResult.rows.map((row) => toBooking(row, user)),
      weeklyBookedCount: Number(countResult.rows[0]?.count ?? 0),
      weeklyBookingLimit: 2,
      settings: policy,
      scheduleDays: Array.from({ length: rangeDays + 1 }, (_, index) =>
        scheduleDay(addDateDays(from, index), policy),
      ),
    });
  } catch (error) {
    console.error('Failed to load bookings', error);
    return json({ error: '预约表暂时无法加载，请稍后重试。' }, 500);
  }
}

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  let body: { slots?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  let user: AuthUser | null;
  let policy: BookingPolicy;
  try {
    [user, policy] = await Promise.all([
      getAuthUser(request),
      getBookingPolicy(),
    ]);
  } catch (error) {
    console.error('Failed to authenticate booking request', error);
    return json({ error: '登录状态检查失败，请稍后重试。' }, 500);
  }
  if (!user) return json({ error: '请先登录后预约。' }, 401);

  const slots = validateSlots(body.slots, policy);
  if (slots instanceof Response) return slots;
  const slotsByWeek = new Map<
    string,
    { from: string; to: string; count: number }
  >();
  for (const slot of slots) {
    const range = weekRange(slot.date);
    const value = slotsByWeek.get(range.from);
    slotsByWeek.set(range.from, {
      ...range,
      count: (value?.count ?? 0) + 1,
    });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const lockedUser = await client.query(
      `SELECT id FROM users WHERE id = $1 AND status = 'approved' FOR UPDATE`,
      [user.id],
    );
    if (!lockedUser.rows[0]) {
      await client.query('ROLLBACK');
      return json({ error: '账号当前不可用，请重新登录。' }, 401);
    }

    for (const range of slotsByWeek.values()) {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM bookings
         WHERE user_id = $1 AND entry_type = 'booking'
           AND booking_date BETWEEN $2::date AND $3::date`,
        [user.id, range.from, range.to],
      );
      if (Number(result.rows[0]?.count ?? 0) + range.count > 2) {
        await client.query('ROLLBACK');
        return json(
          {
            error: `每人每周最多预约 2 个时段（${range.from} 至 ${range.to}）。`,
          },
          409,
        );
      }
    }

    const placeholders = slots
      .map(
        (_, index) =>
          `($${index * 5 + 1}::uuid, $${index * 5 + 2}::date, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5}::uuid, 'booking')`,
      )
      .join(', ');
    const values = slots.flatMap((slot) => [
      crypto.randomUUID(),
      slot.date,
      slot.slotIndex,
      user.displayName,
      user.id,
    ]);
    const result = await client.query<BookingRow>(
      `INSERT INTO bookings
         (id, booking_date, slot_index, member_name, user_id, entry_type)
       VALUES ${placeholders}
       RETURNING id, booking_date::text AS booking_date, slot_index, member_name,
                 user_id, entry_type, lesson_id,
                 created_at::text AS created_at`,
      values,
    );
    await client.query('COMMIT');
    return json(
      { bookings: result.rows.map((row) => toBooking(row, user)) },
      201,
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original database error is more useful than a rollback error.
    }
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === '23505') {
      const conflicts = await findRequestedBookings(slots, user);
      return json(
        {
          error: '部分时段刚刚被预约、活动或固定鼓课占用，请重新选择。',
          conflicts,
        },
        409,
      );
    }
    console.error('Failed to create bookings', error);
    return json({ error: '预约提交失败，请稍后重试。' }, 500);
  } finally {
    client.release();
  }
}
