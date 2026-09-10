import type { PracticeMode } from '@/lib/practice';
import { getPool } from '@/db';
import { getAuthUser } from '@/lib/auth';
import { json } from '@/lib/http';
import {
  addDateDays,
  getBookingPolicy,
  hasSlotStarted,
  shanghaiNow,
  slotForDate,
  weekRange,
} from '@/lib/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return json({ error: '请先登录。' }, 401);
    const currentWeek = weekRange(shanghaiNow().date);
    const policy = await getBookingPolicy();
    const result = await getPool().query<{
      id: string;
      date: string;
      slot_index: number;
      practice_mode: PracticeMode;
    }>(
      `SELECT id, booking_date::text AS date, slot_index, practice_mode FROM bookings
       WHERE user_id = $1 AND entry_type = 'booking'
         AND booking_date BETWEEN $2::date AND $3::date
       ORDER BY booking_date, slot_index`,
      [user.id, currentWeek.from, addDateDays(currentWeek.to, 7)],
    );
    return json({
      weeks: [0, 1].map((offset) => {
        const from = addDateDays(currentWeek.from, offset * 7);
        const to = addDateDays(currentWeek.to, offset * 7);
        const bookings = result.rows
          .filter((row) => row.date >= from && row.date <= to)
          .map((row) => {
            const slot = slotForDate(row.date, row.slot_index, policy);
            return {
              id: row.id,
              date: row.date,
              slotIndex: row.slot_index,
              practiceMode: row.practice_mode,
              period: slot?.period ?? `第 ${row.slot_index + 1} 节`,
              time: slot?.time ?? '时段已调整，请联系管理员',
              canCancel: !hasSlotStarted(row.date, row.slot_index),
            };
          });
        return {
          label: offset === 0 ? '本周' : '下周',
          from,
          to,
          remaining: Math.max(0, 2 - bookings.length),
          bookings,
        };
      }),
    });
  } catch (error) {
    console.error('Failed to load own bookings', error);
    return json({ error: '我的预约加载失败，请稍后重试。' }, 500);
  }
}
