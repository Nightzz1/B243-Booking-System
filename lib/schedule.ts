export const SLOT_START_MINUTES = [
  600, 660, 780, 840, 900, 960, 1020, 1140, 1200, 1260,
];
export const SLOT_COUNT = SLOT_START_MINUTES.length;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
