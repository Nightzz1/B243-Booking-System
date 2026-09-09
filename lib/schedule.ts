import { getPool } from '@/db';

export type ScheduleMode = 'semester' | 'vacation';

export type BookingPolicy = {
  semesterStart: string;
  semesterEnd: string;
  updatedAt: string | null;
};

export type ScheduleSlot = {
  slotIndex: number;
  period: string;
  time: string;
  isPublic: boolean;
};

export type ScheduleDay = {
  date: string;
  mode: ScheduleMode;
  bookingOpenDate: string;
  bookingOpenAt: string;
  bookingOpen: boolean;
  slots: Array<
    ScheduleSlot & {
      hasStarted: boolean;
      selectableForBooking: boolean;
      selectableForActivity: boolean;
    }
  >;
};

export const SEMESTER_SLOTS: ScheduleSlot[] = [
  { slotIndex: 0, period: '第一节', time: '8:00–8:50', isPublic: false },
  { slotIndex: 1, period: '第二节', time: '9:00–9:50', isPublic: false },
  { slotIndex: 2, period: '第三节', time: '10:10–11:00', isPublic: true },
  { slotIndex: 3, period: '第四节', time: '11:10–12:00', isPublic: true },
  { slotIndex: 4, period: '第五节', time: '13:00–13:50', isPublic: true },
  { slotIndex: 5, period: '第六节', time: '14:00–14:50', isPublic: true },
  { slotIndex: 6, period: '第七节', time: '15:10–16:00', isPublic: false },
  { slotIndex: 7, period: '第八节', time: '16:10–17:00', isPublic: false },
  { slotIndex: 8, period: '第九节', time: '17:10–18:00', isPublic: false },
  { slotIndex: 9, period: '第十节', time: '18:40–19:30', isPublic: false },
  { slotIndex: 10, period: '第十一节', time: '19:40–20:30', isPublic: false },
  { slotIndex: 11, period: '第十二节', time: '20:40–21:30', isPublic: false },
  { slotIndex: 12, period: '第十三节', time: '21:40–22:30', isPublic: false },
];

export const VACATION_SLOTS: ScheduleSlot[] = [
  { slotIndex: 0, period: '第一节', time: '8:00–8:50', isPublic: false },
  { slotIndex: 1, period: '第二节', time: '9:00–9:50', isPublic: false },
  { slotIndex: 2, period: '第三节', time: '10:10–11:00', isPublic: false },
  { slotIndex: 3, period: '第四节', time: '11:10–12:00', isPublic: false },
  { slotIndex: 4, period: '第五节', time: '13:00–13:50', isPublic: false },
  { slotIndex: 5, period: '第六节', time: '14:00–14:50', isPublic: false },
  { slotIndex: 6, period: '第七节', time: '15:10–16:00', isPublic: false },
  { slotIndex: 7, period: '第八节', time: '16:10–17:00', isPublic: false },
  { slotIndex: 8, period: '第九节', time: '17:10–18:00', isPublic: false },
  { slotIndex: 9, period: '第十节', time: '18:40–19:30', isPublic: false },
  { slotIndex: 10, period: '第十一节', time: '19:40–21:00', isPublic: false },
];

export const SLOT_START_MINUTES = [
  480, 540, 610, 670, 780, 840, 910, 970, 1030, 1120, 1180, 1240, 1300,
];
export const SLOT_COUNT = SLOT_START_MINUTES.length;
export const BOOKING_OPEN_HOUR = 13;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SEMESTER_START = '2026-09-07';
const DEFAULT_SEMESTER_END = '2027-01-10';

export function isRealDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function dateKey(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function addDateDays(value: string, count: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKey(date);
}

export function isoWeekday(value: string) {
  const weekday = dateFromKey(value).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function weekRange(value: string) {
  const date = dateFromKey(value);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  const from = dateKey(date);
  return { from, to: addDateDays(from, 6) };
}

export function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function hasSlotStarted(date: string, slotIndex: number) {
  const now = shanghaiNow();
  if (date < now.date) return true;
  if (date > now.date) return false;
  return SLOT_START_MINUTES[slotIndex] <= now.minuteOfDay;
}

export function scheduleModeForDate(
  date: string,
  policy: BookingPolicy,
): ScheduleMode {
  return date >= policy.semesterStart && date <= policy.semesterEnd
    ? 'semester'
    : 'vacation';
}

export function slotsForDate(date: string, policy: BookingPolicy) {
  if (scheduleModeForDate(date, policy) === 'vacation') {
    return VACATION_SLOTS;
  }
  if (isoWeekday(date) <= 5) return SEMESTER_SLOTS;
  return SEMESTER_SLOTS.map((slot) =>
    slot.isPublic ? { ...slot, isPublic: false } : slot,
  );
}

export function bookingOpenDate(date: string) {
  const weekday = dateFromKey(date).getUTCDay();
  const daysBack =
    weekday >= 1 && weekday <= 4 ? weekday : weekday === 0 ? 3 : weekday - 4;
  return addDateDays(date, -daysBack);
}

export function bookingOpenAt(date: string) {
  return `${bookingOpenDate(date)}T${String(BOOKING_OPEN_HOUR).padStart(2, '0')}:00:00+08:00`;
}

export function isBookingOpen(date: string) {
  return Date.now() >= Date.parse(bookingOpenAt(date));
}

export function slotForDate(
  date: string,
  slotIndex: number,
  policy: BookingPolicy,
) {
  return slotsForDate(date, policy).find(
    (slot) => slot.slotIndex === slotIndex,
  );
}

export function scheduleDay(date: string, policy: BookingPolicy): ScheduleDay {
  const bookingOpen = isBookingOpen(date);
  return {
    date,
    mode: scheduleModeForDate(date, policy),
    bookingOpenDate: bookingOpenDate(date),
    bookingOpenAt: bookingOpenAt(date),
    bookingOpen,
    slots: slotsForDate(date, policy).map((slot) => {
      const hasStarted = hasSlotStarted(date, slot.slotIndex);
      return {
        ...slot,
        hasStarted,
        selectableForBooking: bookingOpen && !slot.isPublic && !hasStarted,
        selectableForActivity: !slot.isPublic && !hasStarted,
      };
    }),
  };
}

function initialSemesterRange() {
  const semesterStart =
    process.env.INITIAL_SEMESTER_START?.trim() || DEFAULT_SEMESTER_START;
  const semesterEnd =
    process.env.INITIAL_SEMESTER_END?.trim() || DEFAULT_SEMESTER_END;
  if (
    !isRealDate(semesterStart) ||
    !isRealDate(semesterEnd) ||
    semesterStart > semesterEnd ||
    isoWeekday(semesterStart) !== 1 ||
    isoWeekday(semesterEnd) !== 7
  ) {
    throw new Error(
      'INITIAL_SEMESTER_START 必须是周一，INITIAL_SEMESTER_END 必须是周日',
    );
  }
  return { semesterStart, semesterEnd };
}

type PolicyRow = {
  semester_start: string;
  semester_end: string;
  updated_at: string;
};

function toPolicy(row: PolicyRow): BookingPolicy {
  return {
    semesterStart: row.semester_start,
    semesterEnd: row.semester_end,
    updatedAt: row.updated_at,
  };
}

export async function getBookingPolicy(): Promise<BookingPolicy> {
  const initial = initialSemesterRange();
  await getPool().query(
    `INSERT INTO booking_settings (id, semester_start, semester_end)
     VALUES ('default', $1::date, $2::date)
     ON CONFLICT (id) DO NOTHING`,
    [initial.semesterStart, initial.semesterEnd],
  );
  const result = await getPool().query<PolicyRow>(
    `SELECT semester_start::text AS semester_start,
            semester_end::text AS semester_end,
            updated_at::text AS updated_at
     FROM booking_settings WHERE id = 'default'`,
  );
  return toPolicy(result.rows[0]);
}

export async function saveBookingPolicy(
  semesterStart: string,
  semesterEnd: string,
  userId: string,
) {
  const result = await getPool().query<PolicyRow>(
    `INSERT INTO booking_settings
       (id, semester_start, semester_end, updated_by, updated_at)
     VALUES ('default', $1::date, $2::date, $3::uuid, now())
     ON CONFLICT (id) DO UPDATE
       SET semester_start = EXCLUDED.semester_start,
           semester_end = EXCLUDED.semester_end,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING semester_start::text AS semester_start,
               semester_end::text AS semester_end,
               updated_at::text AS updated_at`,
    [semesterStart, semesterEnd, userId],
  );
  return toPolicy(result.rows[0]);
}
