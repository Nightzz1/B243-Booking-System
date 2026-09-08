'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Drum,
  Info,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TIME_SLOTS = [
  '10:00–11:00',
  '11:00–12:00',
  '13:00–14:00',
  '14:00–15:00',
  '15:00–16:00',
  '16:00–17:00',
  '17:00–18:00',
  '19:00–20:00',
  '20:00–21:00',
  '21:00–22:00',
];

type Booking = {
  id: string;
  date: string;
  slotIndex: number;
  memberName: string;
  createdAt: string;
};

type SlotRequest = { date: string; slotIndex: number };

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  result.setUTCHours(12, 0, 0, 0);
  return result;
}

function addDays(date: Date, count: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

function dateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function clubToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), 12));
}

function weekLabel(days: Date[]) {
  const start = days[0];
  const end = days[6];
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCFullYear()}年 ${start.getUTCMonth() + 1}月${start.getUTCDate()}日–${end.getUTCDate()}日`
    : `${start.getUTCFullYear()}年 ${start.getUTCMonth() + 1}月${start.getUTCDate()}日–${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
}

export default function Home() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeDay, setActiveDay] = useState(() => (clubToday().getUTCDay() + 6) % 7);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const days = useMemo(() => {
    const monday = addDays(startOfWeek(clubToday()), weekOffset * 7);
    return WEEKDAYS.map((_, index) => addDays(monday, index));
  }, [weekOffset]);

  const todayKey = dateKey(clubToday());

  function bookingKey(dayIndex: number, slotIndex: number) {
    return `${dateKey(days[dayIndex])}|${slotIndex}`;
  }

  const refreshBookings = useCallback(async (signal?: AbortSignal) => {
    const from = dateKey(days[0]);
    const to = dateKey(days[6]);
    try {
      const response = await fetch(`/api/bookings?from=${from}&to=${to}`, {
        cache: 'no-store',
        signal,
      });
      const data = (await response.json()) as { bookings?: Booking[]; error?: string };
      if (!response.ok || !data.bookings) throw new Error(data.error ?? '预约表加载失败');
      setBookings(
        Object.fromEntries(
          data.bookings.map((booking) => [`${booking.date}|${booking.slotIndex}`, booking]),
        ),
      );
      setNoticeIsError(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setNotice(error instanceof Error ? error.message : '预约表加载失败，请稍后重试。');
      setNoticeIsError(true);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/react-compiler -- This effect intentionally starts remote data synchronization.
    void refreshBookings(controller.signal);
    const interval = window.setInterval(() => void refreshBookings(), 15_000);
    const refreshOnFocus = () => void refreshBookings();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [refreshBookings]);

  function toggleSlot(dayIndex: number, slotIndex: number) {
    const key = bookingKey(dayIndex, slotIndex);
    if (bookings[key]) return;
    setNotice('');
    setNoticeIsError(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function moveWeek(direction: number) {
    setLoading(true);
    setWeekOffset((current) => current + direction);
    setSelected(new Set());
    setNotice('');
    setNoticeIsError(false);
  }

  const submitBooking = useCallback(async (name: string, slots: SlotRequest[]) => {
    setSubmitting(true);
    setNotice('');
    setNoticeIsError(false);
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberName: name, slots }),
      });
      const data = (await response.json()) as {
        bookings?: Booking[];
        conflicts?: Booking[];
        error?: string;
      };

      if (data.conflicts?.length) {
        setBookings((current) => ({
          ...current,
          ...Object.fromEntries(
            data.conflicts!.map((booking) => [
              `${booking.date}|${booking.slotIndex}`,
              booking,
            ]),
          ),
        }));
        setSelected((current) => {
          const next = new Set(current);
          data.conflicts!.forEach((booking) => next.delete(`${booking.date}|${booking.slotIndex}`));
          return next;
        });
      }
      if (!response.ok || !data.bookings) {
        throw new Error(data.error ?? '预约提交失败，请稍后重试。');
      }

      setBookings((current) => ({
        ...current,
        ...Object.fromEntries(
          data.bookings!.map((booking) => [
            `${booking.date}|${booking.slotIndex}`,
            booking,
          ]),
        ),
      }));
      setSelected(new Set());
      setDialogOpen(false);
      setNotice(`预约成功：已为 ${name} 锁定 ${data.bookings.length} 个时段`);
      return data.bookings;
    } catch (error) {
      const message = error instanceof Error ? error.message : '预约提交失败，请稍后重试。';
      setNotice(message);
      setNoticeIsError(true);
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, []);

  async function confirmBooking() {
    const name = memberName.trim();
    if (!name || selected.size === 0) return;
    const slots = Array.from(selected).map((key) => {
      const [date, slotIndex] = key.split('|');
      return { date, slotIndex: Number(slotIndex) };
    });
    try {
      await submitBooking(name, slots);
      setMemberName('');
    } catch {
      // The shared submit path already shows an actionable message.
    }
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: 'create_drum_room_booking',
          title: '预约鼓房',
          description: '用社员姓名一次预约一个或多个鼓房时段，并同步更新当前预约表。',
          inputSchema: {
            type: 'object',
            properties: {
              memberName: { type: 'string', minLength: 1, maxLength: 20 },
              slots: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                    slotIndex: { type: 'integer', minimum: 0, maximum: TIME_SLOTS.length - 1 },
                  },
                  required: ['date', 'slotIndex'],
                  additionalProperties: false,
                },
              },
            },
            required: ['memberName', 'slots'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input: unknown) {
            if (!input || typeof input !== 'object') throw new Error('预约参数格式不正确。');
            const value = input as { memberName?: unknown; slots?: unknown };
            if (typeof value.memberName !== 'string' || !Array.isArray(value.slots)) {
              throw new Error('请提供社员姓名和预约时段。');
            }
            const created = await submitBooking(value.memberName.trim(), value.slots as SlotRequest[]);
            return { status: 'confirmed', count: created.length };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch((error) => console.warn('WebMCP tool registration failed', error));

    return () => lifecycle.abort();
  }, [submitBooking]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-[#111416] text-white">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_24px_rgb(255_191_47/18%)]">
              <Drum aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="font-heading text-base font-bold tracking-tight sm:text-lg">鼓房预约</p>
              <p className="hidden text-xs text-white/50 sm:block">社团排练空间 · 本周开放预约</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/70">
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/10%)]" />
            <span className="hidden sm:inline">系统正常</span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarDays aria-hidden="true" className="size-4" />
              一周预约表
            </p>
            <h1 className="font-heading text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
              {weekLabel(days)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button aria-label="上一周" className="size-10 rounded-xl" onClick={() => moveWeek(-1)} size="icon" variant="outline">
              <ChevronLeft />
            </Button>
            <Button
              className="h-10 rounded-xl px-4"
              onClick={() => {
                setWeekOffset(0);
                setActiveDay((clubToday().getUTCDay() + 6) % 7);
                setSelected(new Set());
              }}
              variant="outline"
            >
              本周
            </Button>
            <Button aria-label="下一周" className="size-10 rounded-xl" onClick={() => moveWeek(1)} size="icon" variant="outline">
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3 text-sm text-foreground/75">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>点击空白时段进行多选，选好后统一确认。已显示姓名的时段不可预约。</p>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {days.map((day, index) => {
            const isToday = dateKey(day) === todayKey;
            return (
              <button
                key={dateKey(day)}
                className={cn(
                  'min-w-[70px] rounded-xl border px-3 py-2 text-center transition',
                  activeDay === index
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-muted-foreground',
                )}
                onClick={() => setActiveDay(index)}
                type="button"
              >
                <span className="block text-xs">{WEEKDAYS[index]}</span>
                <span className="mt-0.5 block text-lg font-bold">{day.getDate()}</span>
                {isToday && <span className="mt-1 block text-[11px] text-primary">今天</span>}
              </button>
            );
          })}
        </div>

        <div className="schedule-shell overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_18px_60px_rgb(17_20_22/7%)]">
          <div className="hidden grid-cols-[108px_repeat(7,minmax(105px,1fr))] border-b border-border bg-muted/55 md:grid">
            <div className="flex items-center gap-2 border-r border-border px-4 py-4 text-sm font-semibold text-muted-foreground">
              <Clock3 aria-hidden="true" className="size-4" /> 时间
            </div>
            {days.map((day, index) => {
              const isToday = dateKey(day) === todayKey;
              return (
                <div
                  key={dateKey(day)}
                  className={cn('border-r border-border px-3 py-3 text-center last:border-r-0', isToday && 'bg-primary/10')}
                >
                  <span className="block text-sm font-medium text-muted-foreground">{WEEKDAYS[index]}</span>
                  <span className="mt-0.5 block text-lg font-extrabold">{day.getMonth() + 1}/{day.getDate()}</span>
                  {isToday && <span className="text-xs font-semibold text-amber-700">今天</span>}
                </div>
              );
            })}
          </div>

          {TIME_SLOTS.map((time, slotIndex) => (
            <div
              className="grid grid-cols-[96px_1fr] border-b border-border last:border-b-0 md:grid-cols-[108px_repeat(7,minmax(105px,1fr))]"
              key={time}
            >
              <div className="flex min-h-16 items-center border-r border-border bg-muted/30 px-3 text-sm font-semibold tabular-nums text-muted-foreground md:px-4">
                {time}
              </div>
              {days.map((day, dayIndex) => {
                const key = bookingKey(dayIndex, slotIndex);
                const booking = bookings[key];
                const bookedBy = booking?.memberName;
                const isSelected = selected.has(key);
                const isVisible = dayIndex === activeDay;
                return (
                  <button
                    aria-label={bookedBy ? `${WEEKDAYS[dayIndex]} ${time}，已由${bookedBy}预约` : `${WEEKDAYS[dayIndex]} ${time}${isSelected ? '，已选择' : '，可预约'}`}
                    aria-pressed={isSelected}
                    className={cn(
                      'group relative min-h-16 border-r border-border px-2 text-left transition last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block',
                      !isVisible && 'hidden',
                      bookedBy ? 'cursor-not-allowed bg-foreground/[0.035]' : 'hover:bg-primary/8 active:bg-primary/15',
                      isSelected && 'bg-primary/18 hover:bg-primary/22',
                    )}
                    disabled={Boolean(bookedBy) || loading}
                    key={dateKey(day)}
                    onClick={() => toggleSlot(dayIndex, slotIndex)}
                    type="button"
                  >
                    {bookedBy ? (
                      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-lg bg-foreground/8 px-2.5 py-1.5 text-sm font-bold text-foreground/75">
                        <Users aria-hidden="true" className="size-3.5" /> {bookedBy}
                      </span>
                    ) : isSelected ? (
                      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-bold text-primary-foreground shadow-sm">
                        <Check aria-hidden="true" className="size-3.5" /> 已选择
                      </span>
                    ) : (
                      <span className="sr-only">选择这个时段</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-[#111416] p-4 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-sm text-white/55">当前选择</p>
            <p className="mt-0.5 font-semibold">{selected.size > 0 ? `已选择 ${selected.size} 个时段` : '还没有选择时段'}</p>
          </div>
          <Button className="h-11 rounded-xl px-5 text-sm font-bold" disabled={selected.size === 0 || loading} onClick={() => setDialogOpen(true)}>
            {loading ? '正在同步…' : '确认预约'}
            {selected.size > 0 && <span className="rounded-md bg-black/15 px-1.5 py-0.5 text-xs">{selected.size}</span>}
          </Button>
        </div>

        <p
          aria-live="polite"
          className={cn(
            'mt-4 min-h-6 text-center text-sm font-semibold',
            noticeIsError ? 'text-destructive' : 'text-emerald-700',
          )}
        >
          {notice}
        </p>
      </section>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold">确认本次预约</DialogTitle>
            <DialogDescription>共选择 {selected.size} 个时段。请填写社员姓名，确认后姓名会显示在预约表中。</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-semibold" htmlFor="member-name">
            社员姓名
            <Input
              className="h-11 rounded-xl"
              id="member-name"
              maxLength={20}
              onChange={(event) => setMemberName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void confirmBooking();
              }}
              placeholder="请输入你的名字"
              value={memberName}
            />
          </label>
          <DialogFooter className="mt-1">
            <Button className="h-10 rounded-xl" disabled={!memberName.trim() || submitting} onClick={confirmBooking}>
              {submitting ? '正在锁定时段…' : '完成预约'}
            </Button>
            <Button className="h-10 rounded-xl" disabled={submitting} onClick={() => setDialogOpen(false)} variant="outline">返回修改</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
