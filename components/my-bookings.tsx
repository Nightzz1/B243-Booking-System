'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type OwnBooking = {
  id: string;
  date: string;
  slotIndex: number;
  period: string;
  time: string;
  canCancel: boolean;
};
type OwnWeek = {
  label: string;
  from: string;
  to: string;
  remaining: number;
  bookings: OwnBooking[];
};

export function MyBookings({
  revision,
  onChanged,
  onSessionExpired,
}: {
  revision: number;
  onChanged: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const [weeks, setWeeks] = useState<OwnWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [cancel, setCancel] = useState<OwnBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch('/api/bookings/mine', {
          cache: 'no-store',
          signal,
        });
        if (response.status === 401) {
          onSessionExpired();
          return;
        }
        const data = (await response.json()) as {
          weeks?: OwnWeek[];
          error?: string;
        };
        if (!response.ok || !data.weeks)
          throw new Error(data.error ?? '预约加载失败。');
        if (!signal?.aborted) {
          setWeeks(data.weeks);
          setError('');
        }
      } catch (error) {
        if (!signal?.aborted)
          setError(error instanceof Error ? error.message : '预约加载失败。');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [onSessionExpired],
  );

  useEffect(() => {
    const controller = new AbortController();
    const initialLoad = window.setTimeout(
      () => void load(controller.signal),
      0,
    );
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load, revision]);

  async function cancelBooking() {
    if (!cancel || busy) return;
    setBusy(true);
    setActionError('');
    setMessage('');
    try {
      const response = await fetch(`/api/bookings/${cancel.id}`, {
        method: 'DELETE',
      });
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? '取消失败。');
      setCancel(null);
      setMessage('预约已取消，该周可预约次数已更新。');
      await onChanged();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '取消失败，请稍后重试。',
      );
      setCancel(null);
    } finally {
      await load();
      setBusy(false);
    }
  }
  const next = weeks
    .flatMap((week) => week.bookings)
    .find((booking) => booking.canCancel);
  return (
    <section
      aria-labelledby="my-bookings-title"
      className="mb-6 rounded-2xl border bg-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="my-bookings-title"
          className="flex items-center gap-2 font-heading text-lg font-bold"
        >
          <CalendarDays className="size-5" />
          我的预约
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {actionError}
        </p>
      )}
      {message && <output className="mt-3 block text-sm">{message}</output>}
      {loading && weeks.length === 0 ? (
        <output className="mt-3 block text-sm text-muted-foreground">
          正在加载我的预约…
        </output>
      ) : (
        weeks.length > 0 && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {next
                ? `下次预约：${next.date} ${next.period} ${next.time}（北京时间）`
                : '暂无即将开始的个人预约，去下方时间表选择时段吧。'}
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {weeks.map((week) => (
                <div key={week.from} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <h3 className="font-semibold">
                      {week.label}{' '}
                      <span className="font-normal text-muted-foreground">
                        {week.from.slice(5)}–{week.to.slice(5)}
                      </span>
                    </h3>
                    <span>
                      已预约 {week.bookings.length}/2 · 剩余 {week.remaining} 次
                    </span>
                  </div>
                  {week.bookings.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      还没有个人预约
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {week.bookings.map((booking) => (
                        <li
                          key={booking.id}
                          className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3"
                        >
                          <div className="min-w-0 text-sm">
                            <p className="font-medium">
                              {booking.date} · {booking.period}
                            </p>
                            <p className="text-muted-foreground">
                              {booking.time}
                            </p>
                          </div>
                          {booking.canCancel ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy || loading}
                              onClick={() => {
                                setError('');
                                setCancel(booking);
                              }}
                            >
                              取消预约
                            </Button>
                          ) : (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              已开始 / 已结束
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        )
      )}
      <Dialog
        open={Boolean(cancel)}
        onOpenChange={(open) => {
          if (!open && !busy) setCancel(null);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>取消这次预约？</DialogTitle>
            <DialogDescription>
              {cancel?.date} {cancel?.period} {cancel?.time}
              。取消后时段将重新开放，该周会恢复一次可预约次数。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setCancel(null)}
            >
              保留预约
            </Button>
            <Button disabled={busy} onClick={() => void cancelBooking()}>
              {busy ? '正在取消…' : '确认取消'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
