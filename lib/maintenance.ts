import { getPool } from '@/db';
import { RETAINED_PAST_WEEKS } from '@/lib/booking-window';
import {
  addDateDays,
  getBookingPolicy,
  isoWeekday,
  shanghaiNow,
  weekRange,
} from '@/lib/schedule';

const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
const globalForMaintenance = globalThis as typeof globalThis & {
  bookingCleanupStarted?: boolean;
  bookingCleanupTimer?: ReturnType<typeof setTimeout>;
};

function millisecondsUntilNextMonday() {
  const today = shanghaiNow().date;
  const daysUntilMonday = 8 - isoWeekday(today);
  const nextMonday = addDateDays(today, daysUntilMonday);
  return Math.max(
    1_000,
    Date.parse(`${nextMonday}T00:00:00+08:00`) - Date.now(),
  );
}

export async function runWeeklyBookingCleanup() {
  await getBookingPolicy();
  const currentWeek = weekRange(shanghaiNow().date).from;
  const cutoff = addDateDays(currentWeek, -RETAINED_PAST_WEEKS * 7);
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const settings = await client.query<{ last_pruned_week: string | null }>(
      `SELECT last_pruned_week::text AS last_pruned_week
       FROM booking_settings WHERE id = 'default' FOR UPDATE`,
    );
    const result = await client.query(
      'DELETE FROM bookings WHERE booking_date < $1::date',
      [cutoff],
    );
    await client.query(
      'DELETE FROM drum_lesson_pauses WHERE pause_week < $1::date',
      [cutoff],
    );
    await client.query(
      'DELETE FROM lesson_cancellation_audits WHERE booking_date < $1::date',
      [cutoff],
    );
    if (settings.rows[0]?.last_pruned_week === currentWeek) {
      await client.query('COMMIT');
      return {
        ran: (result.rowCount ?? 0) > 0,
        deleted: result.rowCount ?? 0,
        week: currentWeek,
        cutoff,
      };
    }
    await client.query(
      `UPDATE booking_settings
       SET last_pruned_week = $1::date
       WHERE id = 'default'`,
      [currentWeek],
    );
    await client.query('COMMIT');
    return {
      ran: true,
      deleted: result.rowCount ?? 0,
      week: currentWeek,
      cutoff,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function scheduleNextCleanup() {
  const delay = Math.min(millisecondsUntilNextMonday(), WEEK_MILLISECONDS);
  globalForMaintenance.bookingCleanupTimer = setTimeout(async () => {
    try {
      const result = await runWeeklyBookingCleanup();
      if (result.ran) {
        console.info(
          `Weekly booking cleanup completed: ${result.deleted} record(s) deleted`,
        );
      }
    } catch (error) {
      console.error('Weekly booking cleanup failed', error);
    } finally {
      scheduleNextCleanup();
    }
  }, delay);
  globalForMaintenance.bookingCleanupTimer.unref?.();
}

export function startWeeklyBookingCleanup() {
  if (globalForMaintenance.bookingCleanupStarted) return;
  globalForMaintenance.bookingCleanupStarted = true;

  void runWeeklyBookingCleanup()
    .catch((error) =>
      console.error('Initial weekly booking cleanup failed', error),
    )
    .finally(scheduleNextCleanup);
}
