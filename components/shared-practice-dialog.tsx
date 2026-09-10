'use client';

import type { Booking } from '@/lib/booking-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function SharedPracticeDialog({
  entries,
  description,
  canJoin,
  joinHint,
  submitting,
  error,
  onJoin,
  onCancel,
  onClose,
}: {
  entries: Booking[];
  description: string;
  canJoin: boolean;
  joinHint: string;
  submitting: boolean;
  error?: string;
  onJoin: () => void;
  onCancel: (booking: Booking) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>共同练习 · {entries.length} 人</DialogTitle>
          <DialogDescription>
            {description}。每人单独计入每周配额，退出只取消自己的预约。
          </DialogDescription>
        </DialogHeader>
        {entries.length ? (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-semibold">
                    {entry.memberName}
                    {entry.isOwn ? '（我）' : ''}
                  </p>
                  {entry.contact && (
                    <div className="mt-1 break-all text-muted-foreground">
                      <p>电话：{entry.contact.phone}</p>
                      <p>微信：{entry.contact.wechat}</p>
                    </div>
                  )}
                </div>
                {entry.canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => onCancel(entry)}
                  >
                    {entry.isOwn ? '退出练习' : '取消该预约'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            该共同练习已取消，请关闭后重新选择时段。
          </p>
        )}
        <p className="text-sm text-muted-foreground">{joinHint}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          {(canJoin || submitting) && (
            <Button onClick={onJoin} disabled={submitting}>
              {submitting ? '正在加入…' : '确认加入'}
            </Button>
          )}
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
