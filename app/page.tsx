'use client';

import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Drum,
  Info,
  LogIn,
  LogOut,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
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
import { LessonManagement } from '@/components/lesson-management';
import {
  maxVisibleWeekOffsetForRole,
  minVisibleWeekOffsetForRole,
} from '@/lib/booking-window';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const FALLBACK_SLOTS = [
  { slotIndex: 0, period: '第一节', time: '8:00–8:50' },
  { slotIndex: 1, period: '第二节', time: '9:00–9:50' },
  { slotIndex: 2, period: '第三节', time: '10:10–11:00' },
  { slotIndex: 3, period: '第四节', time: '11:10–12:00' },
  { slotIndex: 4, period: '第五节', time: '13:00–13:50' },
  { slotIndex: 5, period: '第六节', time: '14:00–14:50' },
  { slotIndex: 6, period: '第七节', time: '15:10–16:00' },
  { slotIndex: 7, period: '第八节', time: '16:10–17:00' },
  { slotIndex: 8, period: '第九节', time: '17:10–18:00' },
  { slotIndex: 9, period: '第十节', time: '18:40–19:30' },
  { slotIndex: 10, period: '第十一节', time: '19:40–20:30' },
  { slotIndex: 11, period: '第十二节', time: '20:40–21:30' },
  { slotIndex: 12, period: '第十三节', time: '21:40–22:30' },
];
const SESSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type UserRole = 'system_admin' | 'club_admin' | 'member';
type UserStatus = 'pending' | 'approved' | 'rejected';
type EntryMode = 'booking' | 'activity';
type ScheduleEntryType = EntryMode | 'lesson';
type ScheduleMode = 'semester' | 'vacation';

type BookingSettings = {
  semesterStart: string;
  semesterEnd: string;
  updatedAt: string | null;
};

type ScheduleSlot = {
  slotIndex: number;
  period: string;
  time: string;
  isPublic: boolean;
  hasStarted: boolean;
  selectableForBooking: boolean;
  selectableForActivity: boolean;
};

type ScheduleDay = {
  date: string;
  mode: ScheduleMode;
  bookingOpenDate: string;
  bookingOpenAt: string;
  bookingOpen: boolean;
  slots: ScheduleSlot[];
};

type AuthUser = {
  id: string;
  account: string;
  displayName: string;
  phone: string;
  wechat: string;
  role: UserRole;
  status: UserStatus;
};

type Booking = {
  id: string;
  date: string;
  slotIndex: number;
  memberName: string;
  entryType: ScheduleEntryType;
  lessonId: string | null;
  createdAt: string;
  isOwn: boolean;
  canCancel: boolean;
  contact: { phone: string; wechat: string } | null;
};

type ManagedUser = AuthUser & {
  createdAt: string;
  approvedAt: string | null;
};

type SlotRequest = { date: string; slotIndex: number };

const ROLE_LABELS: Record<UserRole, string> = {
  system_admin: '系统管理员',
  club_admin: '鼓房管理员',
  member: '普通社员',
};

const STATUS_LABELS: Record<UserStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过',
};

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
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const value = [values.year, values.month, values.day].map(Number);
  return new Date(Date.UTC(value[0], value[1] - 1, value[2], 12));
}

function weekLabel(days: Date[]) {
  const start = days[0];
  const end = days[6];
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCFullYear()}年 ${start.getUTCMonth() + 1}月${start.getUTCDate()}日–${end.getUTCDate()}日`
    : `${start.getUTCFullYear()}年 ${start.getUTCMonth() + 1}月${start.getUTCDate()}日–${end.getUTCMonth() + 1}月${end.getUTCDate()}日`;
}

async function readJson<T>(response: Response) {
  return (await response.json()) as T;
}

function AuthScreen({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [wechat, setWechat] = useState('');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setMessage('');
    setIsError(false);
    setPassword('');
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (mode === 'register' && password !== confirmPassword) {
      setMessage('两次输入的密码不一致。');
      setIsError(true);
      return;
    }

    setSubmitting(true);
    setMessage('');
    setIsError(false);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'login'
            ? { account, password }
            : { account, password, displayName, phone, wechat },
        ),
      });
      const data = await readJson<{
        user?: AuthUser;
        message?: string;
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(data.error ?? '操作失败，请稍后重试。');

      if (mode === 'login' && data.user) {
        onLogin(data.user);
        return;
      }
      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setMessage(data.message ?? '注册申请已提交，请等待管理员审核。');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '操作失败，请稍后重试。',
      );
      setIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#111416] px-4 py-10 text-white">
      <div className="w-full max-w-md">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_0_40px_rgb(255_191_47/22%)]">
            <Drum aria-hidden="true" className="size-7" />
          </span>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight">
            鼓房预约
          </h1>
          <p className="mt-2 text-sm text-white/55">
            登录后查看预约表并选择排练时段
          </p>
        </div>

        <div className="rounded-3xl bg-card p-5 text-card-foreground shadow-2xl sm:p-7">
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-muted p-1">
            <button
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-bold transition',
                mode === 'login' && 'bg-card shadow-sm',
              )}
              onClick={() => switchMode('login')}
              type="button"
            >
              登录
            </button>
            <button
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-bold transition',
                mode === 'register' && 'bg-card shadow-sm',
              )}
              onClick={() => switchMode('register')}
              type="button"
            >
              注册
            </button>
          </div>

          <form className="grid gap-4" onSubmit={submit}>
            <label
              className="grid gap-2 text-sm font-semibold"
              htmlFor="account"
            >
              学号 / 工号
              <Input
                autoCapitalize="none"
                autoComplete="username"
                className="h-11 rounded-xl"
                id="account"
                maxLength={32}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="字母、数字、下划线或连字符"
                required
                value={account}
              />
            </label>

            {mode === 'register' && (
              <>
                <label
                  className="grid gap-2 text-sm font-semibold"
                  htmlFor="display-name"
                >
                  姓名
                  <Input
                    autoComplete="name"
                    className="h-11 rounded-xl"
                    id="display-name"
                    maxLength={40}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="预约表将显示此姓名"
                    required
                    value={displayName}
                  />
                </label>
                <label
                  className="grid gap-2 text-sm font-semibold"
                  htmlFor="phone"
                >
                  电话号码
                  <Input
                    autoComplete="tel"
                    className="h-11 rounded-xl"
                    id="phone"
                    inputMode="tel"
                    maxLength={32}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="手机号或其他常用电话"
                    required
                    value={phone}
                  />
                </label>
                <label
                  className="grid gap-2 text-sm font-semibold"
                  htmlFor="wechat"
                >
                  微信号
                  <Input
                    autoCapitalize="none"
                    className="h-11 rounded-xl"
                    id="wechat"
                    maxLength={64}
                    onChange={(event) => setWechat(event.target.value)}
                    placeholder="请输入可联系到你的微信号"
                    required
                    value={wechat}
                  />
                </label>
              </>
            )}

            <label
              className="grid gap-2 text-sm font-semibold"
              htmlFor="password"
            >
              密码
              <Input
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                className="h-11 rounded-xl"
                id="password"
                maxLength={128}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  mode === 'register' ? '至少 8 个字符' : '请输入密码'
                }
                required
                type="password"
                value={password}
              />
            </label>

            {mode === 'register' && (
              <label
                className="grid gap-2 text-sm font-semibold"
                htmlFor="confirm-password"
              >
                确认密码
                <Input
                  autoComplete="new-password"
                  className="h-11 rounded-xl"
                  id="confirm-password"
                  maxLength={128}
                  minLength={8}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  type="password"
                  value={confirmPassword}
                />
              </label>
            )}

            <Button
              className="mt-1 h-11 rounded-xl font-bold"
              disabled={submitting}
              type="submit"
            >
              {mode === 'login' ? <LogIn /> : <UserPlus />}
              {submitting
                ? '正在提交…'
                : mode === 'login'
                  ? '登录'
                  : '提交注册申请'}
            </Button>
          </form>

          <p
            aria-live="polite"
            className={cn(
              'mt-4 min-h-5 text-center text-sm font-semibold',
              isError ? 'text-destructive' : 'text-emerald-700',
            )}
          >
            {message}
          </p>
          {mode === 'register' && (
            <p className="mt-2 text-center text-xs leading-5 text-muted-foreground">
              电话号码和微信号均为必填。新账号默认为普通社员，审核通过后才能登录。
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeDay, setActiveDay] = useState(
    () => (clubToday().getUTCDay() + 6) % 7,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [scheduleDays, setScheduleDays] = useState<Record<string, ScheduleDay>>(
    {},
  );
  const [bookingSettings, setBookingSettings] =
    useState<BookingSettings | null>(null);
  const [semesterStart, setSemesterStart] = useState('');
  const [semesterEnd, setSemesterEnd] = useState('');
  const [weeklyBookedCount, setWeeklyBookedCount] = useState(0);
  const [entryMode, setEntryMode] = useState<EntryMode>('booking');
  const [activityTitle, setActivityTitle] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelEntry, setCancelEntry] = useState<Booking | null>(null);
  const [contactEntry, setContactEntry] = useState<Booking | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminNotice, setAdminNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeIsError, setNoticeIsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const days = useMemo(() => {
    const monday = addDays(startOfWeek(clubToday()), weekOffset * 7);
    return WEEKDAYS.map((_, index) => addDays(monday, index));
  }, [weekOffset]);
  const todayKey = dateKey(clubToday());
  const canManage =
    user?.role === 'system_admin' || user?.role === 'club_admin';
  const minVisibleWeekOffset = minVisibleWeekOffsetForRole(
    user?.role ?? 'member',
  );
  const maxVisibleWeekOffset = maxVisibleWeekOffsetForRole(
    user?.role ?? 'member',
  );
  const bookingRemaining = Math.max(0, 2 - weeklyBookedCount);
  const displaySlots = useMemo(() => {
    const mondaySchedule = scheduleDays[dateKey(days[0])];
    return mondaySchedule?.slots ?? FALLBACK_SLOTS;
  }, [days, scheduleDays]);
  const weekScheduleLabel = useMemo(() => {
    const mode = scheduleDays[dateKey(days[0])]?.mode;
    return mode === 'vacation' ? '假期时段表' : '学期时段表';
  }, [days, scheduleDays]);
  const atEarliestWeek = weekOffset <= minVisibleWeekOffset;
  const atLatestWeek = weekOffset >= maxVisibleWeekOffset;

  function slotDescription(entry: Booking) {
    const slot = scheduleDays[entry.date]?.slots.find(
      (item) => item.slotIndex === entry.slotIndex,
    );
    const fallback = FALLBACK_SLOTS[entry.slotIndex];
    return `${slot?.period ?? fallback?.period ?? `第 ${entry.slotIndex + 1} 节`} ${slot?.time ?? fallback?.time ?? ''}`.trim();
  }

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => readJson<{ user?: AuthUser | null }>(response))
      .then((data) => {
        if (active) setUser(data.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await readJson<{ user?: AuthUser | null }>(response);
        if (!active) return;
        if (!data.user) setUser(null);
        else setUser(data.user);
      } catch {
        // A transient network failure must not log the user out locally.
      }
    };
    const interval = window.setInterval(
      () => void checkSession(),
      SESSION_CHECK_INTERVAL_MS,
    );
    const checkOnFocus = () => void checkSession();
    window.addEventListener('focus', checkOnFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkOnFocus);
    };
  }, [user]);

  const refreshBookings = useCallback(
    async (signal?: AbortSignal) => {
      if (!user) return;
      const from = dateKey(days[0]);
      const to = dateKey(days[6]);
      try {
        const response = await fetch(`/api/bookings?from=${from}&to=${to}`, {
          cache: 'no-store',
          signal,
        });
        const data = await readJson<{
          bookings?: Booking[];
          weeklyBookedCount?: number;
          settings?: BookingSettings;
          scheduleDays?: ScheduleDay[];
          error?: string;
        }>(response);
        if (response.status === 401) {
          setUser(null);
          throw new Error('登录已失效，请重新登录。');
        }
        if (!response.ok || !data.bookings)
          throw new Error(data.error ?? '预约表加载失败。');
        setBookings(
          Object.fromEntries(
            data.bookings.map((booking) => [
              `${booking.date}|${booking.slotIndex}`,
              booking,
            ]),
          ),
        );
        setWeeklyBookedCount(data.weeklyBookedCount ?? 0);
        if (data.settings) setBookingSettings(data.settings);
        if (data.scheduleDays) {
          setScheduleDays(
            Object.fromEntries(
              data.scheduleDays.map((schedule) => [schedule.date, schedule]),
            ),
          );
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setNotice(
          error instanceof Error
            ? error.message
            : '预约表加载失败，请稍后重试。',
        );
        setNoticeIsError(true);
      } finally {
        setLoading(false);
      }
    },
    [days, user],
  );

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    // oxlint-disable-next-line react/react-compiler -- This effect intentionally starts remote synchronization.
    void refreshBookings(controller.signal);
    const interval = window.setInterval(() => void refreshBookings(), 15_000);
    const refreshOnFocus = () => void refreshBookings();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [refreshBookings, user]);

  function bookingKey(dayIndex: number, slotIndex: number) {
    return `${dateKey(days[dayIndex])}|${slotIndex}`;
  }

  function toggleSlot(dayIndex: number, slotIndex: number) {
    const key = bookingKey(dayIndex, slotIndex);
    const booking = bookings[key];
    if (booking) {
      if (booking.entryType === 'lesson') return;
      if (booking.entryType === 'activity') {
        if (entryMode === 'activity' && booking.canCancel) {
          setCancelEntry(booking);
        }
      } else if (booking.isOwn) {
        if (booking.canCancel) setCancelEntry(booking);
      } else {
        setContactEntry(booking);
      }
      return;
    }

    const date = dateKey(days[dayIndex]);
    const daySchedule = scheduleDays[date];
    const scheduleSlot = daySchedule?.slots.find(
      (slot) => slot.slotIndex === slotIndex,
    );
    const selectable =
      entryMode === 'booking'
        ? scheduleSlot?.selectableForBooking
        : scheduleSlot?.selectableForActivity;
    if (!selectable) {
      if (!scheduleSlot) {
        setNotice('假期时段表中没有这个节次。');
      } else if (scheduleSlot.isPublic) {
        setNotice('学期内周一至周五的第三节至第六节为公用时段，不开放预约。');
      } else if (scheduleSlot.hasStarted) {
        setNotice('不能选择已经开始或过去的时段。');
      } else if (entryMode === 'booking' && !daySchedule.bookingOpen) {
        setNotice(
          `该日期尚未开放预约，将于 ${daySchedule.bookingOpenDate} 13:00 开放。`,
        );
      } else {
        setNotice('当前时段不可选择。');
      }
      setNoticeIsError(true);
      return;
    }

    setNotice('');
    setNoticeIsError(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const limit = entryMode === 'booking' ? bookingRemaining : 20;
        if (next.size >= limit) {
          setNotice(
            entryMode === 'booking'
              ? '你本周最多还能选择这些预约时段。'
              : '一次最多登记 20 个活动时段。',
          );
          setNoticeIsError(true);
          return current;
        }
        next.add(key);
      }
      return next;
    });
  }

  function showWeek(offset: number) {
    if (offset < minVisibleWeekOffset || offset > maxVisibleWeekOffset) {
      return;
    }
    setSelected(new Set());
    setNotice('');
    setNoticeIsError(false);
    if (offset === weekOffset) return;
    setLoading(true);
    setWeekOffset(offset);
    setScheduleDays({});
  }

  function moveWeek(direction: number) {
    showWeek(weekOffset + direction);
  }

  function changeEntryMode(mode: EntryMode) {
    setEntryMode(mode);
    setSelected(new Set());
    setCancelEntry(null);
    setContactEntry(null);
    setNotice('');
    setNoticeIsError(false);
  }

  const submitPersonalBooking = useCallback(async (slots: SlotRequest[]) => {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots }),
    });
    const data = await readJson<{ bookings?: Booking[]; error?: string }>(
      response,
    );
    if (!response.ok || !data.bookings)
      throw new Error(data.error ?? '预约提交失败。');
    return data.bookings;
  }, []);

  async function confirmSelection() {
    if (!user || selected.size === 0 || submitting) return;
    if (entryMode === 'activity' && !activityTitle.trim()) return;
    const slots = Array.from(selected).map((key) => {
      const [date, slotIndex] = key.split('|');
      return { date, slotIndex: Number(slotIndex) };
    });

    setSubmitting(true);
    setNotice('');
    setNoticeIsError(false);
    try {
      if (entryMode === 'booking') {
        await submitPersonalBooking(slots);
      } else {
        const response = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: activityTitle.trim(), slots }),
        });
        const data = await readJson<{ error?: string }>(response);
        if (!response.ok) throw new Error(data.error ?? '活动登记失败。');
      }
      const count = slots.length;
      setSelected(new Set());
      setConfirmOpen(false);
      setActivityTitle('');
      setNotice(
        entryMode === 'booking'
          ? `预约成功：已锁定 ${count} 个时段。`
          : `活动登记成功：已占用 ${count} 个时段。`,
      );
      await refreshBookings();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '提交失败，请稍后重试。',
      );
      setNoticeIsError(true);
      await refreshBookings();
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelSelectedEntry() {
    if (!cancelEntry || submitting) return;
    if (cancelEntry.entryType === 'activity' && entryMode !== 'activity') {
      setCancelEntry(null);
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/bookings/${cancelEntry.id}`, {
        method: 'DELETE',
      });
      const data = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? '取消失败。');
      setCancelEntry(null);
      setNotice(
        cancelEntry.entryType === 'activity'
          ? '活动时段已移除。'
          : '预约已取消。',
      );
      setNoticeIsError(false);
      await refreshBookings();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '取消失败，请稍后重试。',
      );
      setNoticeIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setWeekOffset(0);
      setBookings({});
      setScheduleDays({});
      setSelected(new Set());
    }
  }

  async function openAdmin() {
    setAdminOpen(true);
    setAdminLoading(true);
    setAdminNotice('');
    try {
      const [usersResponse, settingsResponse] = await Promise.all([
        fetch('/api/admin/users', { cache: 'no-store' }),
        fetch('/api/admin/settings', { cache: 'no-store' }),
      ]);
      const usersData = await readJson<{
        users?: ManagedUser[];
        error?: string;
      }>(usersResponse);
      const settingsData = await readJson<{
        settings?: BookingSettings;
        error?: string;
      }>(settingsResponse);
      if (!usersResponse.ok || !usersData.users) {
        throw new Error(usersData.error ?? '用户列表加载失败。');
      }
      if (!settingsResponse.ok || !settingsData.settings) {
        throw new Error(settingsData.error ?? '预约设置加载失败。');
      }
      setManagedUsers(usersData.users);
      setBookingSettings(settingsData.settings);
      setSemesterStart(settingsData.settings.semesterStart);
      setSemesterEnd(settingsData.settings.semesterEnd);
    } catch (error) {
      setAdminNotice(
        error instanceof Error ? error.message : '用户列表加载失败。',
      );
    } finally {
      setAdminLoading(false);
    }
  }

  async function saveSemesterSettings() {
    if (!semesterStart || !semesterEnd || adminLoading) return;
    setAdminLoading(true);
    setAdminNotice('');
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semesterStart, semesterEnd }),
      });
      const data = await readJson<{
        settings?: BookingSettings;
        error?: string;
      }>(response);
      if (!response.ok || !data.settings) {
        throw new Error(data.error ?? '学期时间保存失败。');
      }
      setBookingSettings(data.settings);
      setSemesterStart(data.settings.semesterStart);
      setSemesterEnd(data.settings.semesterEnd);
      setAdminNotice('学期时间已保存，预约表已按新日期范围更新。');
      setLoading(true);
      await refreshBookings();
    } catch (error) {
      setAdminNotice(
        error instanceof Error ? error.message : '学期时间保存失败。',
      );
    } finally {
      setAdminLoading(false);
    }
  }

  async function updateManagedUser(
    userId: string,
    action: 'approve' | 'reject' | 'set_role',
    role?: 'member' | 'club_admin',
  ) {
    setAdminLoading(true);
    setAdminNotice('');
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, role }),
      });
      const data = await readJson<{ user?: ManagedUser; error?: string }>(
        response,
      );
      if (!response.ok || !data.user)
        throw new Error(data.error ?? '账号更新失败。');
      setManagedUsers((current) =>
        current.map((item) => (item.id === data.user!.id ? data.user! : item)),
      );
      setAdminNotice('账号状态已更新。');
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : '账号更新失败。');
    } finally {
      setAdminLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: 'create_drum_room_booking',
          title: '预约鼓房',
          description: '使用当前登录账号预约一到两个鼓房时段。',
          inputSchema: {
            type: 'object',
            properties: {
              slots: {
                type: 'array',
                minItems: 1,
                maxItems: 2,
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                    slotIndex: {
                      type: 'integer',
                      minimum: 0,
                      maximum: 12,
                    },
                  },
                  required: ['date', 'slotIndex'],
                  additionalProperties: false,
                },
              },
            },
            required: ['slots'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input: unknown) {
            if (
              !input ||
              typeof input !== 'object' ||
              !Array.isArray((input as { slots?: unknown }).slots)
            ) {
              throw new Error('请提供预约时段。');
            }
            const created = await submitPersonalBooking(
              (input as { slots: SlotRequest[] }).slots,
            );
            await refreshBookings();
            return { status: 'confirmed', count: created.length };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch((error) => console.warn('WebMCP tool registration failed', error));

    return () => lifecycle.abort();
  }, [refreshBookings, submitPersonalBooking, user]);

  if (authLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#111416] text-white">
        <div className="flex items-center gap-3 text-sm text-white/65">
          <span className="size-2 animate-pulse rounded-full bg-primary" />{' '}
          正在加载账号状态…
        </div>
      </main>
    );
  }
  if (!user) {
    return (
      <AuthScreen
        onLogin={(nextUser) => {
          setLoading(true);
          setWeekOffset(0);
          setUser(nextUser);
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-[#111416] text-white">
        <div className="mx-auto flex min-h-16 max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_24px_rgb(255_191_47/18%)]">
              <Drum aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="font-heading text-base font-bold tracking-tight sm:text-lg">
                鼓房预约
              </p>
              <p className="hidden text-xs text-white/50 sm:block">
                社团排练空间 · 账号制预约
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canManage && (
              <Button
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                onClick={() => void openAdmin()}
                variant="outline"
              >
                <ClipboardCheck /> 管理设置
              </Button>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">{user.displayName}</p>
              <p className="text-xs text-white/50">
                {user.account} · {ROLE_LABELS[user.role]}
              </p>
            </div>
            <Button
              aria-label="退出登录"
              className="text-white hover:bg-white/10"
              onClick={() => void logout()}
              size="icon"
              variant="ghost"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarDays aria-hidden="true" className="size-4" /> 一周预约表
            </p>
            <h1 className="font-heading text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
              {weekLabel(days)}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="h-9 rounded-xl px-3" variant="secondary">
              本周已预约 {weeklyBookedCount}/2
            </Badge>
            <Badge className="h-9 rounded-xl px-3" variant="outline">
              {weekScheduleLabel}
            </Badge>
            <Button
              aria-label="上一周"
              className="size-10 rounded-xl"
              disabled={atEarliestWeek}
              onClick={() => moveWeek(-1)}
              size="icon"
              variant="outline"
            >
              <ChevronLeft />
            </Button>
            <Button
              className="h-10 rounded-xl px-4"
              onClick={() => {
                showWeek(0);
                setActiveDay((clubToday().getUTCDay() + 6) % 7);
              }}
              variant="outline"
            >
              本周
            </Button>
            <Button
              aria-label="下一周"
              className="size-10 rounded-xl"
              disabled={atLatestWeek}
              onClick={() => moveWeek(1)}
              size="icon"
              variant="outline"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        {canManage && (
          <div className="mb-4 flex w-fit rounded-xl bg-muted p-1">
            <button
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition',
                entryMode === 'booking' && 'bg-card shadow-sm',
              )}
              onClick={() => changeEntryMode('booking')}
              type="button"
            >
              <CalendarDays className="size-4" /> 个人预约
            </button>
            <button
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition',
                entryMode === 'activity' && 'bg-card shadow-sm',
              )}
              onClick={() => changeEntryMode('activity')}
              type="button"
            >
              <CalendarPlus className="size-4" /> 管理活动
            </button>
          </div>
        )}

        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3 text-sm text-foreground/75">
          <Info
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-600"
          />
          <p>
            {entryMode === 'booking'
              ? `每周日 13:00 开放下一周周一至周四，每周四 13:00 开放本周周五至周日。每人每周最多预约 2 段，你本周还可预约 ${bookingRemaining} 段；学期内周一至周五的第三至第六节为公用时段。活动只能在“管理活动”中修改。`
              : '请选择尚未开始的空白时段登记社团活动；管理员可向后查看并安排未来 16 周。活动可以提前登记，但学期内周一至周五的第三至第六节是公用时段，不能占用。周末第三至第六节可以正常登记。'}
          </p>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto pb-1 md:hidden">
          {days.map((day, index) => {
            const isToday = dateKey(day) === todayKey;
            return (
              <button
                className={cn(
                  'min-w-[70px] rounded-xl border px-3 py-2 text-center transition',
                  activeDay === index
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-muted-foreground',
                )}
                key={dateKey(day)}
                onClick={() => setActiveDay(index)}
                type="button"
              >
                <span className="block text-xs">{WEEKDAYS[index]}</span>
                <span className="mt-0.5 block text-lg font-bold">
                  {day.getUTCDate()}
                </span>
                {isToday && (
                  <span className="mt-1 block text-[11px] text-primary">
                    今天
                  </span>
                )}
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
                  className={cn(
                    'border-r border-border px-3 py-3 text-center last:border-r-0',
                    isToday && 'bg-primary/10',
                  )}
                  key={dateKey(day)}
                >
                  <span className="block text-sm font-medium text-muted-foreground">
                    {WEEKDAYS[index]}
                  </span>
                  <span className="mt-0.5 block text-lg font-extrabold">
                    {day.getUTCMonth() + 1}/{day.getUTCDate()}
                  </span>
                  {isToday && (
                    <span className="text-xs font-semibold text-amber-700">
                      今天
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {displaySlots.map(({ slotIndex, period, time }) => (
            <div
              className="grid grid-cols-[96px_1fr] border-b border-border last:border-b-0 md:grid-cols-[108px_repeat(7,minmax(105px,1fr))]"
              key={slotIndex}
            >
              <div className="flex min-h-16 flex-col justify-center border-r border-border bg-muted/30 px-3 text-muted-foreground md:px-4">
                <span className="text-sm font-bold text-foreground/80">
                  {period}
                </span>
                <span className="mt-0.5 text-xs font-semibold tabular-nums">
                  {time}
                </span>
              </div>
              {days.map((day, dayIndex) => {
                const date = dateKey(day);
                const key = bookingKey(dayIndex, slotIndex);
                const booking = bookings[key];
                const isSelected = selected.has(key);
                const isVisible = dayIndex === activeDay;
                const daySchedule = scheduleDays[date];
                const scheduleSlot = daySchedule?.slots.find(
                  (slot) => slot.slotIndex === slotIndex,
                );
                const selectable = Boolean(
                  entryMode === 'booking'
                    ? scheduleSlot?.selectableForBooking
                    : scheduleSlot?.selectableForActivity,
                );
                const unavailableLabel = !scheduleSlot
                  ? '假期无此节次'
                  : scheduleSlot.isPublic
                    ? '公用时段'
                    : entryMode === 'booking' && !daySchedule?.bookingOpen
                      ? '未开放'
                      : '';
                const bookingIsInteractive = Boolean(
                  booking &&
                  (booking.entryType === 'booking'
                    ? !booking.isOwn || booking.canCancel
                    : booking.entryType === 'activity' &&
                      entryMode === 'activity' &&
                      booking.canCancel),
                );
                const showDirectDelete = Boolean(
                  booking &&
                  booking.canCancel &&
                  (booking.entryType === 'activity'
                    ? entryMode === 'activity'
                    : booking.isOwn),
                );
                return (
                  <button
                    aria-label={
                      booking
                        ? `${WEEKDAYS[dayIndex]} ${scheduleSlot?.period ?? period} ${scheduleSlot?.time ?? time}，${booking.entryType === 'activity' ? '活动' : booking.entryType === 'lesson' ? '鼓课' : '预约'}：${booking.memberName}${booking.entryType === 'booking' && !booking.isOwn ? '，点击查看联系方式' : showDirectDelete ? '，点击可取消' : scheduleSlot?.hasStarted ? '，已结束且不可修改' : ''}`
                        : `${WEEKDAYS[dayIndex]} ${scheduleSlot?.period ?? period} ${scheduleSlot?.time ?? time}，${unavailableLabel || (isSelected ? '已选择' : scheduleSlot?.hasStarted ? '无人预约，已结束且不可修改' : '可选择')}`
                    }
                    aria-pressed={isSelected}
                    className={cn(
                      'group relative min-h-16 border-r border-border px-2 text-left transition last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block',
                      !isVisible && 'hidden',
                      !booking &&
                        selectable &&
                        'hover:bg-primary/8 active:bg-primary/15',
                      !booking && !selectable && 'cursor-not-allowed',
                      !booking &&
                        !selectable &&
                        !scheduleSlot?.hasStarted &&
                        'bg-muted/45',
                      !booking &&
                        scheduleSlot?.isPublic &&
                        'bg-sky-50/80 text-sky-900',
                      booking?.entryType === 'booking' &&
                        'bg-foreground/[0.035]',
                      booking?.entryType === 'activity' && 'bg-amber-100/65',
                      booking?.entryType === 'lesson' && 'bg-violet-100/75',
                      booking?.entryType === 'booking' &&
                        !booking.isOwn &&
                        'cursor-pointer hover:bg-primary/8',
                      showDirectDelete &&
                        'cursor-pointer hover:bg-destructive/8',
                      scheduleSlot?.hasStarted &&
                        !scheduleSlot.isPublic &&
                        'bg-muted/80 text-muted-foreground hover:bg-muted/80',
                      isSelected && 'bg-primary/18 hover:bg-primary/22',
                    )}
                    disabled={
                      loading ||
                      (!booking && !selectable) ||
                      Boolean(booking && !bookingIsInteractive)
                    }
                    key={dateKey(day)}
                    onClick={() => toggleSlot(dayIndex, slotIndex)}
                    type="button"
                  >
                    {booking ? (
                      <span
                        className={cn(
                          'mx-auto flex w-fit max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold',
                          booking.entryType === 'activity'
                            ? 'bg-amber-500/18 text-amber-950'
                            : booking.entryType === 'lesson'
                              ? 'bg-violet-500/18 text-violet-950'
                              : booking.isOwn
                                ? 'bg-primary/30 text-foreground'
                                : 'bg-foreground/8 text-foreground/75',
                        )}
                      >
                        {booking.entryType === 'activity' ? (
                          <CalendarPlus
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        ) : booking.entryType === 'lesson' ? (
                          <Drum aria-hidden="true" className="size-3.5" />
                        ) : (
                          <Users aria-hidden="true" className="size-3.5" />
                        )}
                        <span className="truncate">
                          {booking.entryType === 'lesson'
                            ? `鼓课：${booking.memberName}`
                            : booking.memberName}
                        </span>
                        {showDirectDelete && (
                          <Trash2
                            aria-hidden="true"
                            className="size-3 text-destructive"
                          />
                        )}
                      </span>
                    ) : isSelected ? (
                      <span className="mx-auto flex w-fit items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-bold text-primary-foreground shadow-sm">
                        <Check aria-hidden="true" className="size-3.5" /> 已选择
                      </span>
                    ) : unavailableLabel ? (
                      <span className="mx-auto block w-fit text-xs font-medium text-muted-foreground/60">
                        {unavailableLabel}
                      </span>
                    ) : (
                      <span className="sr-only">
                        {scheduleSlot?.hasStarted
                          ? '无人预约，已结束且不可修改'
                          : '选择这个时段'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-[#111416] p-4 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="text-sm text-white/55">
              {entryMode === 'booking' ? '个人预约' : '社团活动'}
            </p>
            <p className="mt-0.5 font-semibold">
              {selected.size > 0
                ? `已选择 ${selected.size} 个时段`
                : '还没有选择时段'}
            </p>
          </div>
          <Button
            className="h-11 rounded-xl px-5 text-sm font-bold"
            disabled={selected.size === 0 || loading}
            onClick={() => setConfirmOpen(true)}
          >
            {loading
              ? '正在同步…'
              : entryMode === 'booking'
                ? '确认预约'
                : '登记活动'}
            {selected.size > 0 && (
              <span className="rounded-md bg-black/15 px-1.5 py-0.5 text-xs">
                {selected.size}
              </span>
            )}
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

      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold">
              {entryMode === 'booking' ? '确认本次预约' : '确认登记活动'}
            </DialogTitle>
            <DialogDescription>
              {entryMode === 'booking'
                ? `将以 ${user.displayName} 的账号预约所选 ${selected.size} 个时段。`
                : `所选 ${selected.size} 个时段会被活动占用，并在后续开放预约时保留。`}
            </DialogDescription>
          </DialogHeader>
          {entryMode === 'activity' && (
            <label
              className="grid gap-2 text-sm font-semibold"
              htmlFor="activity-title"
            >
              活动名称
              <Input
                className="h-11 rounded-xl"
                id="activity-title"
                maxLength={80}
                onChange={(event) => setActivityTitle(event.target.value)}
                placeholder="例如：社团例行排练"
                value={activityTitle}
              />
            </label>
          )}
          <DialogFooter className="mt-1">
            <Button
              className="h-10 rounded-xl"
              disabled={
                submitting ||
                (entryMode === 'activity' && !activityTitle.trim())
              }
              onClick={() => void confirmSelection()}
            >
              {submitting
                ? '正在提交…'
                : entryMode === 'booking'
                  ? '完成预约'
                  : '确认占用'}
            </Button>
            <Button
              className="h-10 rounded-xl"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
              variant="outline"
            >
              返回修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && setContactEntry(null)}
        open={Boolean(contactEntry)}
      >
        <DialogContent className="max-w-md rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold">
              {contactEntry?.memberName} 的联系方式
            </DialogTitle>
            <DialogDescription>
              预约时段：{contactEntry?.date}{' '}
              {contactEntry ? slotDescription(contactEntry) : ''}
            </DialogDescription>
          </DialogHeader>
          {contactEntry?.contact ? (
            <div className="grid gap-3 rounded-2xl bg-muted/60 p-4">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  电话号码
                </p>
                <p className="mt-1 break-all font-semibold">
                  {contactEntry.contact.phone}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  微信号
                </p>
                <p className="mt-1 break-all font-semibold">
                  {contactEntry.contact.wechat}
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
              这是升级账号机制前留下的预约，暂时没有关联联系方式。
            </p>
          )}
          <DialogFooter>
            {contactEntry?.canCancel && (
              <Button
                onClick={() => {
                  setCancelEntry(contactEntry);
                  setContactEntry(null);
                }}
                variant="destructive"
              >
                <Trash2 /> 管理员取消预约
              </Button>
            )}
            <Button onClick={() => setContactEntry(null)} variant="outline">
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && setCancelEntry(null)}
        open={Boolean(cancelEntry)}
      >
        <DialogContent className="max-w-md rounded-2xl p-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold">
              {cancelEntry?.entryType === 'activity'
                ? '移除活动时段'
                : '取消预约'}
            </DialogTitle>
            <DialogDescription>
              确定要取消 {cancelEntry?.date}{' '}
              {cancelEntry ? slotDescription(cancelEntry) : ''} 的“
              {cancelEntry?.memberName}”吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={submitting}
              onClick={() => void cancelSelectedEntry()}
              variant="destructive"
            >
              <Trash2 /> {submitting ? '正在取消…' : '确认取消'}
            </Button>
            <Button
              disabled={submitting}
              onClick={() => setCancelEntry(null)}
              variant="outline"
            >
              保留
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setAdminOpen} open={adminOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto rounded-2xl p-5 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-extrabold">
              <ShieldCheck className="size-5" /> 账号、权限与预约设置
            </DialogTitle>
            <DialogDescription>
              系统管理员和鼓房管理员可以设置学期时间、审核注册；只有系统管理员可以授予或撤销鼓房管理员身份。
            </DialogDescription>
          </DialogHeader>

          <section className="rounded-2xl border bg-muted/35 p-4">
            <div>
              <p className="font-bold">本学期时间</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                学期必须从周一开始、在周日结束。学期内使用 13
                节学期表，其他完整周使用 11 节假期表。
              </p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label
                className="grid gap-1.5 text-sm font-semibold"
                htmlFor="semester-start"
              >
                开始日期
                <Input
                  disabled={adminLoading}
                  id="semester-start"
                  onChange={(event) => setSemesterStart(event.target.value)}
                  type="date"
                  value={semesterStart}
                />
              </label>
              <label
                className="grid gap-1.5 text-sm font-semibold"
                htmlFor="semester-end"
              >
                结束日期
                <Input
                  disabled={adminLoading}
                  id="semester-end"
                  min={semesterStart}
                  onChange={(event) => setSemesterEnd(event.target.value)}
                  type="date"
                  value={semesterEnd}
                />
              </label>
              <Button
                disabled={
                  adminLoading ||
                  !semesterStart ||
                  !semesterEnd ||
                  (bookingSettings?.semesterStart === semesterStart &&
                    bookingSettings?.semesterEnd === semesterEnd)
                }
                onClick={() => void saveSemesterSettings()}
              >
                保存学期时间
              </Button>
            </div>
          </section>

          <LessonManagement
            active={adminOpen}
            onScheduleChange={refreshBookings}
            settings={bookingSettings}
          />

          <div className="mt-2">
            <h3 className="font-bold">账号审核与身份管理</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              已审核账号的身份设置会单独显示在账号卡片下方。
            </p>
          </div>

          <div className="grid gap-3">
            {adminLoading && managedUsers.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                正在加载账号…
              </p>
            )}
            {!adminLoading && managedUsers.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                目前没有注册申请。
              </p>
            )}
            {managedUsers.map((item) => {
              const mayReview =
                user.role === 'system_admin' || item.role === 'member';
              return (
                <div className="rounded-2xl border bg-card p-4" key={item.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold">{item.displayName}</p>
                        <Badge
                          variant={
                            item.status === 'approved'
                              ? 'secondary'
                              : item.status === 'rejected'
                                ? 'destructive'
                                : 'default'
                          }
                        >
                          {STATUS_LABELS[item.status]}
                        </Badge>
                        <Badge variant="outline">
                          {ROLE_LABELS[item.role]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        账号：{item.account}
                      </p>
                      <p className="mt-0.5 break-all text-sm text-muted-foreground">
                        电话：{item.phone}
                      </p>
                      <p className="mt-0.5 break-all text-sm text-muted-foreground">
                        微信：{item.wechat}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.status !== 'approved' && mayReview && (
                        <Button
                          disabled={adminLoading}
                          onClick={() =>
                            void updateManagedUser(item.id, 'approve')
                          }
                          size="sm"
                        >
                          <Check /> 通过
                        </Button>
                      )}
                      {item.status !== 'rejected' && mayReview && (
                        <Button
                          disabled={adminLoading}
                          onClick={() =>
                            void updateManagedUser(item.id, 'reject')
                          }
                          size="sm"
                          variant="destructive"
                        >
                          拒绝
                        </Button>
                      )}
                    </div>
                  </div>
                  {user.role === 'system_admin' && (
                    <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-bold">鼓房管理员权限</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.status === 'approved'
                            ? '选择该账号在系统中的身份。'
                            : '请先通过该账号的注册申请，再设置身份。'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:flex">
                        <Button
                          disabled={adminLoading || item.status !== 'approved'}
                          onClick={() =>
                            void updateManagedUser(
                              item.id,
                              'set_role',
                              'member',
                            )
                          }
                          size="sm"
                          variant={
                            item.role === 'member' ? 'default' : 'outline'
                          }
                        >
                          普通社员
                        </Button>
                        <Button
                          disabled={adminLoading || item.status !== 'approved'}
                          onClick={() =>
                            void updateManagedUser(
                              item.id,
                              'set_role',
                              'club_admin',
                            )
                          }
                          size="sm"
                          variant={
                            item.role === 'club_admin' ? 'default' : 'outline'
                          }
                        >
                          鼓房管理员
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p
            aria-live="polite"
            className="min-h-5 text-center text-sm font-semibold text-muted-foreground"
          >
            {adminNotice}
          </p>
        </DialogContent>
      </Dialog>
    </main>
  );
}
