import { getPool } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BookingRow = {
  id: string;
  booking_date: string;
  slot_index: number;
  member_name: string;
  created_at: string;
};

type RequestedSlot = {
  date: string;
  slotIndex: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SLOTS_PER_REQUEST = 20;
const SLOT_COUNT = 10;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isRealDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function toBooking(row: BookingRow) {
  return {
    id: row.id,
    date: row.booking_date,
    slotIndex: row.slot_index,
    memberName: row.member_name,
    createdAt: row.created_at,
  };
}

async function findRequestedBookings(slots: RequestedSlot[]) {
  const predicate = slots
    .map(
      (_, index) =>
        `(booking_date = $${index * 2 + 1}::date AND slot_index = $${index * 2 + 2})`,
    )
    .join(' OR ');
  const values = slots.flatMap((slot) => [slot.date, slot.slotIndex]);
  const result = await getPool().query<BookingRow>(
    `SELECT id, booking_date::text AS booking_date, slot_index, member_name,
            created_at::text AS created_at
     FROM bookings
     WHERE ${predicate}
     ORDER BY booking_date, slot_index`,
    values,
  );
  return result.rows.map(toBooking);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';

  if (!isRealDate(from) || !isRealDate(to) || from > to) {
    return json({ error: '请提供有效的起止日期。' }, 400);
  }

  try {
    const result = await getPool().query<BookingRow>(
      `SELECT id, booking_date::text AS booking_date, slot_index, member_name,
              created_at::text AS created_at
       FROM bookings
       WHERE booking_date >= $1::date AND booking_date <= $2::date
       ORDER BY booking_date, slot_index`,
      [from, to],
    );

    return json({ bookings: result.rows.map(toBooking) });
  } catch (error) {
    console.error('Failed to load bookings', error);
    return json({ error: '预约表暂时无法加载，请稍后重试。' }, 500);
  }
}

export async function POST(request: Request) {
  let body: { memberName?: unknown; slots?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  const memberName = typeof body.memberName === 'string' ? body.memberName.trim() : '';
  if (!memberName || memberName.length > 20) {
    return json({ error: '社员姓名需为 1–20 个字符。' }, 400);
  }
  if (!Array.isArray(body.slots) || body.slots.length === 0 || body.slots.length > MAX_SLOTS_PER_REQUEST) {
    return json({ error: '请选择 1–20 个预约时段。' }, 400);
  }

  const slots: RequestedSlot[] = [];
  const seen = new Set<string>();
  for (const value of body.slots) {
    if (!value || typeof value !== 'object') {
      return json({ error: '预约时段格式不正确。' }, 400);
    }
    const candidate = value as { date?: unknown; slotIndex?: unknown };
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
    const key = `${candidate.date}|${slotIndex}`;
    if (seen.has(key)) return json({ error: '预约时段不能重复。' }, 400);
    seen.add(key);
    slots.push({ date: candidate.date, slotIndex });
  }

  const placeholders = slots
    .map(
      (_, index) =>
        `($${index * 4 + 1}::uuid, $${index * 4 + 2}::date, $${index * 4 + 3}, $${index * 4 + 4})`,
    )
    .join(', ');
  const values = slots.flatMap((slot) => [
    crypto.randomUUID(),
    slot.date,
    slot.slotIndex,
    memberName,
  ]);

  try {
    const result = await getPool().query<BookingRow>(
      `INSERT INTO bookings (id, booking_date, slot_index, member_name)
       VALUES ${placeholders}
       RETURNING id, booking_date::text AS booking_date, slot_index, member_name,
                 created_at::text AS created_at`,
      values,
    );

    return json({ bookings: result.rows.map(toBooking) }, 201);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === '23505') {
      const conflicts = await findRequestedBookings(slots);
      return json(
        {
          error: '部分时段刚刚被其他同学预约，请重新选择。',
          conflicts,
        },
        409,
      );
    }
    console.error('Failed to create bookings', error);
    return json({ error: '预约提交失败，请稍后重试。' }, 500);
  }
}
