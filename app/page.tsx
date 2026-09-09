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
const SLOT_START_MINUTES = [
  600, 660, 780, 840, 900, 960, 1020, 1140, 1200, 1260,
];
const SESSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

type UserRole = 'system_admin' | 'club_admin' | 'member';
type UserStatus = 'pending' | 'approved' | 'rejected';
type EntryMode = 'booking' | 'activity';

type AuthUser = {
  id: string;
  account: string;
  displayName: string;
  contact: string;
  role: UserRole;
  status: UserStatus;
};

type Booking = {
  id: string;
  date: string;
  slotIndex: number;
  memberName: string;
  entryType: EntryMode;
  createdAt: string;
  isOwn: boolean;
  canCancel: boolean;
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

function shanghaiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    minuteOfDay: Number(value.hour) * 60 + Number(value.minute),
  };
}

function clubToday() {
  const value = shanghaiNow().date.split('-').map(Number);
  return new Date(Date.UTC(value[0], value[1] - 1, value[2], 12));
}

function slotHasStarted(date: string, slotIndex: number) {
  const now = shanghaiNow();
  if (date < now.date) return true;
  if (date > now.date) return false;
  return SLOT_START_MINUTES[slotIndex] <= now.minuteOfDay;
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
  const [contact, setContact] = useState('');
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
            : { account, password, displayName, contact },
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
                  htmlFor="contact"
                >
                  联系方式
                  <Input
                    autoComplete="tel"
                    className="h-11 rounded-xl"
                    id="contact"
                    maxLength={100}
                    onChange={(event) => setContact(event.target.value)}
                    placeholder="手机号、微信或其他有效联系方式"
                    required
                    value={contact}
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
              新账号默认为普通社员，需经系统管理员或鼓房管理员审核后才能登录。
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
  const [weeklyBookedCount, setWeeklyBookedCount] = useState(0);
  const [entryMode, setEntryMode] = useState<EntryMode>('booking');
  const [activityTitle, setActivityTitle] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelEntry, setCancelEntry] = useState<Booking | null>(null);
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
  const bookingRemaining = Math.max(0, 2 - weeklyBookedCount);

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
      if (booking.canCancel) setCancelEntry(booking);
      return;
    }
    if (slotHasStarted(dateKey(days[dayIndex]), slotIndex)) return;

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

  function moveWeek(direction: number) {
    setLoading(true);
    setWeekOffset((current) => current + direction);
    setSelected(new Set());
    setNotice('');
    setNoticeIsError(false);
  }

  function changeEntryMode(mode: EntryMode) {
    setEntryMode(mode);
    setSelected(new Set());
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
      setBookings({});
      setSelected(new Set());
    }
  }

  async function openAdmin() {
    setAdminOpen(true);
    setAdminLoading(true);
    setAdminNotice('');
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' });
      const data = await readJson<{ users?: ManagedUser[]; error?: string }>(
        response,
      );
      if (!response.ok || !data.users)
        throw new Error(data.error ?? '用户列表加载失败。');
      setManagedUsers(data.users);
    } catch (error) {
      setAdminNotice(
        error instanceof Error ? error.message : '用户列表加载失败。',
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
                      maximum: TIME_SLOTS.length - 1,
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
                <ClipboardCheck /> 账号审核
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
            <Button
              aria-label="上一周"
              className="size-10 rounded-xl"
              onClick={() => moveWeek(-1)}
              size="icon"
              variant="outline"
            >
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
            <Button
              aria-label="下一周"
              className="size-10 rounded-xl"
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
              <CalendarPlus className="size-4" /> 登记活动
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
              ? `点击未来空白时段进行多选；每人每周最多预约 2 段，你本周还可预约 ${bookingRemaining} 段。点击自己可取消的预约可以撤销。`
              : '请选择未来空白时段登记社团活动。活动会持续占用这些时段，普通社员不能预约。'}
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
                const isSelected = selected.has(key);
                const isVisible = dayIndex === activeDay;
                const isPast = slotHasStarted(dateKey(day), slotIndex);
                return (
                  <button
                    aria-label={
                      booking
                        ? `${WEEKDAYS[dayIndex]} ${time}，${booking.entryType === 'activity' ? '活动' : '预约'}：${booking.memberName}${booking.canCancel ? '，点击可取消' : ''}`
                        : `${WEEKDAYS[dayIndex]} ${time}${isPast ? '，已开始' : isSelected ? '，已选择' : '，可选择'}`
                    }
                    aria-pressed={isSelected}
                    className={cn(
                      'group relative min-h-16 border-r border-border px-2 text-left transition last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:block',
                      !isVisible && 'hidden',
                      !booking &&
                        !isPast &&
                        'hover:bg-primary/8 active:bg-primary/15',
                      !booking && isPast && 'cursor-not-allowed bg-muted/45',
                      booking?.entryType === 'booking' &&
                        'bg-foreground/[0.035]',
                      booking?.entryType === 'activity' && 'bg-amber-100/65',
                      booking?.canCancel &&
                        'cursor-pointer hover:bg-destructive/8',
                      isSelected && 'bg-primary/18 hover:bg-primary/22',
                    )}
                    disabled={
                      loading ||
                      (!booking && isPast) ||
                      Boolean(booking && !booking.canCancel)
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
                        ) : (
                          <Users aria-hidden="true" className="size-3.5" />
                        )}
                        <span className="truncate">{booking.memberName}</span>
                        {booking.canCancel && (
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
                    ) : isPast ? (
                      <span className="mx-auto block w-fit text-xs font-medium text-muted-foreground/60">
                        已开始
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
              {cancelEntry ? TIME_SLOTS[cancelEntry.slotIndex] : ''} 的“
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
              <ShieldCheck className="size-5" /> 账号审核与身份管理
            </DialogTitle>
            <DialogDescription>
              系统管理员和鼓房管理员可以审核注册；只有系统管理员可以授予或撤销鼓房管理员身份。
            </DialogDescription>
          </DialogHeader>

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
                        联系方式：{item.contact}
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
                      {user.role === 'system_admin' &&
                        item.status === 'approved' && (
                          <Button
                            disabled={adminLoading}
                            onClick={() =>
                              void updateManagedUser(
                                item.id,
                                'set_role',
                                item.role === 'club_admin'
                                  ? 'member'
                                  : 'club_admin',
                              )
                            }
                            size="sm"
                            variant="outline"
                          >
                            {item.role === 'club_admin'
                              ? '设为普通社员'
                              : '设为鼓房管理员'}
                          </Button>
                        )}
                    </div>
                  </div>
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
