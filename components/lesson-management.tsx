'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarOff,
  Check,
  CircleStop,
  Pencil,
  Play,
  Plus,
  Trash2,
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

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SLOTS = [
  '第一节 8:00–8:50',
  '第二节 9:00–9:50',
  '第三节 10:10–11:00',
  '第四节 11:10–12:00',
  '第五节 13:00–13:50',
  '第六节 14:00–14:50',
  '第七节 15:10–16:00',
  '第八节 16:10–17:00',
  '第九节 17:10–18:00',
  '第十节 18:40–19:30',
  '第十一节 19:40–20:30',
  '第十二节 20:40–21:30',
  '第十三节 21:40–22:30',
];

type BookingSettings = {
  semesterStart: string;
  semesterEnd: string;
};

type LessonOccurrence = {
  date: string;
  paused: boolean;
  started: boolean;
};

type DrumLesson = {
  id: string;
  className: string;
  semesterStart: string;
  semesterEnd: string;
  startWeek: string;
  weekday: number;
  firstSlotIndex: number;
  lastOccurrenceDate: string | null;
  createdAt: string;
  updatedAt: string;
  hasStarted: boolean;
  canDelete: boolean;
  occurrences: LessonOccurrence[];
};

type Conflict = {
  id: string;
  date: string;
  slotIndex: number;
  memberName: string;
  entryType: 'booking' | 'activity' | 'lesson';
  contact: { phone: string; wechat: string } | null;
};

type Mutation = {
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
  successMessage: string;
};

type Props = {
  active: boolean;
  settings: BookingSettings | null;
  onScheduleChange: () => Promise<void>;
};

async function readJson<T>(response: Response) {
  return (await response.json()) as T;
}

function slotOptions(weekday: number) {
  return Array.from({ length: 12 }, (_, index) => index).filter(
    (index) =>
      weekday > 5 ||
      (![2, 3, 4, 5].includes(index) && ![2, 3, 4, 5].includes(index + 1)),
  );
}

function slotPairLabel(firstSlotIndex: number) {
  return `${SLOTS[firstSlotIndex]} + ${SLOTS[firstSlotIndex + 1]}`;
}

export function LessonManagement({
  active,
  settings,
  onScheduleChange,
}: Props) {
  const [lessons, setLessons] = useState<DrumLesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [className, setClassName] = useState('');
  const [startWeek, setStartWeek] = useState(settings?.semesterStart ?? '');
  const [weekday, setWeekday] = useState(1);
  const [firstSlotIndex, setFirstSlotIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pauseDates, setPauseDates] = useState<Record<string, string>>({});
  const [endingLesson, setEndingLesson] = useState<DrumLesson | null>(null);
  const [lastOccurrenceDate, setLastOccurrenceDate] = useState('');
  const [pendingMutation, setPendingMutation] = useState<Mutation | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [communicationConfirmed, setCommunicationConfirmed] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');

  const availableSlots = useMemo(() => slotOptions(weekday), [weekday]);
  const effectiveStartWeek = startWeek || settings?.semesterStart || '';

  const loadLessons = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/lessons', {
        cache: 'no-store',
      });
      const data = await readJson<{ lessons?: DrumLesson[]; error?: string }>(
        response,
      );
      if (!response.ok || !data.lessons) {
        throw new Error(data.error ?? '固定鼓课加载失败。');
      }
      setLessons(data.lessons);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '固定鼓课加载失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // oxlint-disable-next-line react/react-compiler -- This effect intentionally starts remote synchronization.
    void loadLessons();
  }, [active, loadLessons, settings?.semesterEnd, settings?.semesterStart]);

  function resetForm() {
    setEditingId(null);
    setClassName('');
    setStartWeek(settings?.semesterStart ?? '');
    setWeekday(1);
    setFirstSlotIndex(0);
  }

  async function executeMutation(
    mutation: Mutation,
    confirmation?: Record<string, unknown>,
  ) {
    setLoading(true);
    setNotice('');
    try {
      const hasBody = mutation.body || confirmation;
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody
          ? JSON.stringify({ ...mutation.body, ...confirmation })
          : undefined,
      });
      const data = await readJson<{
        lessons?: DrumLesson[];
        error?: string;
        requiresConfirmation?: boolean;
        conflicts?: Conflict[];
        hardConflicts?: Conflict[];
      }>(response);
      if (
        response.status === 409 &&
        data.requiresConfirmation &&
        data.conflicts?.length
      ) {
        setPendingMutation(mutation);
        setConflicts(data.conflicts);
        setCommunicationConfirmed(false);
        setCancellationReason('');
        return false;
      }
      if (!response.ok) {
        const hardText = data.hardConflicts?.length
          ? `（${data.hardConflicts.map((item) => `${item.date} ${SLOTS[item.slotIndex]}：${item.memberName}`).join('；')}）`
          : '';
        throw new Error(`${data.error ?? '操作失败，请稍后重试。'}${hardText}`);
      }
      if (data.lessons) setLessons(data.lessons);
      else await loadLessons();
      setNotice(mutation.successMessage);
      setPendingMutation(null);
      setConflicts([]);
      resetForm();
      await onScheduleChange();
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '操作失败，请稍后重试。',
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  function submitLesson() {
    if (!className.trim() || !effectiveStartWeek) return;
    const body = {
      className: className.trim(),
      startWeek: effectiveStartWeek,
      weekday,
      firstSlotIndex,
    };
    void executeMutation({
      url: editingId ? `/api/admin/lessons/${editingId}` : '/api/admin/lessons',
      method: editingId ? 'PATCH' : 'POST',
      body,
      successMessage: editingId ? '固定鼓课已修改。' : '固定鼓课已登记。',
    });
  }

  function beginEdit(lesson: DrumLesson) {
    setEditingId(lesson.id);
    setClassName(lesson.className);
    setStartWeek(lesson.startWeek);
    setWeekday(lesson.weekday);
    setFirstSlotIndex(lesson.firstSlotIndex);
    setNotice('');
  }

  function changeWeekday(value: number) {
    const options = slotOptions(value);
    setWeekday(value);
    if (!options.includes(firstSlotIndex)) setFirstSlotIndex(options[0]);
  }

  function beginEnd(lesson: DrumLesson) {
    const available = lesson.occurrences.filter(
      (item) => !item.paused && item.started,
    );
    const latestStarted = available.at(-1);
    setEndingLesson(lesson);
    setLastOccurrenceDate(latestStarted?.date ?? available[0]?.date ?? '');
  }

  async function confirmConflictCancellation() {
    if (!pendingMutation) return;
    await executeMutation(pendingMutation, {
      communicationConfirmed,
      cancellationReason: cancellationReason.trim(),
      confirmedConflictIds: conflicts.map((conflict) => conflict.id),
    });
  }

  return (
    <section className="mt-4 rounded-2xl border bg-muted/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-bold">
            <BookOpen className="size-4" /> 固定鼓课
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            每门课从开始周起，每周固定占用同一天连续两个节次，默认持续到本学期结束。
          </p>
        </div>
        <Badge variant="outline">{lessons.length} 门课程</Badge>
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2">
        <label
          className="grid min-w-0 gap-1.5 text-sm font-semibold"
          htmlFor="lesson-class-name"
        >
          班型名称
          <Input
            disabled={loading}
            id="lesson-class-name"
            maxLength={80}
            onChange={(event) => setClassName(event.target.value)}
            placeholder="例如：爵士鼓入门班"
            value={className}
          />
        </label>
        <label
          className="grid min-w-0 gap-1.5 text-sm font-semibold"
          htmlFor="lesson-start-week"
        >
          开始周（请选择周一）
          <Input
            disabled={loading}
            id="lesson-start-week"
            max={settings?.semesterEnd}
            min={settings?.semesterStart}
            onChange={(event) => setStartWeek(event.target.value)}
            type="date"
            value={effectiveStartWeek}
          />
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">
          每周上课日
          <select
            className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
            disabled={loading}
            onChange={(event) => changeWeekday(Number(event.target.value))}
            value={weekday}
          >
            {WEEKDAYS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">
          连续两个节次
          <select
            className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
            disabled={loading}
            onChange={(event) => setFirstSlotIndex(Number(event.target.value))}
            value={firstSlotIndex}
          >
            {availableSlots.map((slotIndex) => (
              <option key={slotIndex} value={slotIndex}>
                {slotPairLabel(slotIndex)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button
            disabled={loading || !className.trim() || !effectiveStartWeek}
            onClick={submitLesson}
            size="sm"
          >
            {editingId ? <Check /> : <Plus />}
            {editingId ? '保存课程修改' : '登记固定鼓课'}
          </Button>
          {editingId && (
            <Button
              disabled={loading}
              onClick={resetForm}
              size="sm"
              variant="outline"
            >
              取消修改
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {loading && lessons.length === 0 && (
          <p className="py-5 text-center text-sm text-muted-foreground">
            正在加载固定鼓课…
          </p>
        )}
        {!loading && lessons.length === 0 && (
          <p className="py-5 text-center text-sm text-muted-foreground">
            本学期还没有登记固定鼓课。
          </p>
        )}
        {lessons.map((lesson) => {
          const paused = lesson.occurrences.filter((item) => item.paused);
          const pauseCandidates = lesson.occurrences.filter(
            (item) => !item.paused && !item.started,
          );
          const selectedPause =
            pauseDates[lesson.id] ?? pauseCandidates[0]?.date ?? '';
          return (
            <article className="rounded-xl border bg-card p-3" key={lesson.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold">{lesson.className}</p>
                    <Badge
                      variant={
                        lesson.lastOccurrenceDate ? 'secondary' : 'default'
                      }
                    >
                      {lesson.lastOccurrenceDate ? '已结课' : '进行中'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {WEEKDAYS[lesson.weekday - 1]} ·{' '}
                    {slotPairLabel(lesson.firstSlotIndex)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {lesson.startWeek} 开始
                    {lesson.lastOccurrenceDate
                      ? `，最后一次课：${lesson.lastOccurrenceDate}`
                      : '，默认持续至学期结束'}
                  </p>
                </div>
                {!lesson.lastOccurrenceDate && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={loading}
                      onClick={() => beginEdit(lesson)}
                      size="sm"
                      variant="outline"
                    >
                      <Pencil /> 修改
                    </Button>
                    {lesson.canDelete ? (
                      <Button
                        disabled={loading}
                        onClick={() =>
                          void executeMutation({
                            url: `/api/admin/lessons/${lesson.id}`,
                            method: 'DELETE',
                            successMessage: '未开始的固定鼓课已删除。',
                          })
                        }
                        size="sm"
                        variant="destructive"
                      >
                        <Trash2 /> 删除
                      </Button>
                    ) : (
                      <Button
                        disabled={loading}
                        onClick={() => beginEnd(lesson)}
                        size="sm"
                        variant="outline"
                      >
                        <CircleStop /> 结束课程
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {!lesson.lastOccurrenceDate && pauseCandidates.length > 0 && (
                <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
                  <select
                    className="h-9 min-w-48 rounded-md border bg-background px-3 text-sm"
                    disabled={loading}
                    onChange={(event) =>
                      setPauseDates((current) => ({
                        ...current,
                        [lesson.id]: event.target.value,
                      }))
                    }
                    value={selectedPause}
                  >
                    {pauseCandidates.map((item) => (
                      <option key={item.date} value={item.date}>
                        {item.date}（{WEEKDAYS[lesson.weekday - 1]}）
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={loading || !selectedPause}
                    onClick={() =>
                      void executeMutation({
                        url: `/api/admin/lessons/${lesson.id}/pauses/${selectedPause}`,
                        method: 'PUT',
                        successMessage: `${selectedPause} 已设为停课，两个时段已释放。`,
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    <CalendarOff /> 设置该周停课
                  </Button>
                </div>
              )}

              {paused.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  <span className="self-center text-xs font-semibold text-muted-foreground">
                    停课周：
                  </span>
                  {paused.map((item) => (
                    <Button
                      disabled={
                        loading ||
                        item.started ||
                        Boolean(lesson.lastOccurrenceDate)
                      }
                      key={item.date}
                      onClick={() =>
                        void executeMutation({
                          url: `/api/admin/lessons/${lesson.id}/pauses/${item.date}`,
                          method: 'DELETE',
                          successMessage: `${item.date} 已恢复上课。`,
                        })
                      }
                      size="sm"
                      variant="outline"
                    >
                      {!item.started && !lesson.lastOccurrenceDate && <Play />}
                      {item.date}
                      {item.started
                        ? '（已过去）'
                        : lesson.lastOccurrenceDate
                          ? ''
                          : '（恢复）'}
                    </Button>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p
        aria-live="polite"
        className="mt-3 min-h-5 text-sm font-semibold text-muted-foreground"
      >
        {notice}
      </p>

      <Dialog
        onOpenChange={(open) => !open && setEndingLesson(null)}
        open={Boolean(endingLesson)}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>结束“{endingLesson?.className}”</DialogTitle>
            <DialogDescription>
              请选择最后一次实际上课日期。该日期保留鼓课，其后的每周固定占用会被释放。
            </DialogDescription>
          </DialogHeader>
          <label
            className="grid gap-1.5 text-sm font-semibold"
            htmlFor="lesson-end-date"
          >
            最后一次上课日期
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              id="lesson-end-date"
              onChange={(event) => setLastOccurrenceDate(event.target.value)}
              value={lastOccurrenceDate}
            >
              {endingLesson?.occurrences
                .filter((item) => !item.paused && item.started)
                .map((item) => (
                  <option key={item.date} value={item.date}>
                    {item.date}（已上课）
                  </option>
                ))}
            </select>
          </label>
          <DialogFooter>
            <Button
              disabled={loading || !lastOccurrenceDate}
              onClick={async () => {
                if (!endingLesson) return;
                const saved = await executeMutation({
                  url: `/api/admin/lessons/${endingLesson.id}/end`,
                  method: 'POST',
                  body: { lastOccurrenceDate },
                  successMessage:
                    '最后一次上课日期已保存，后续固定时段已释放。',
                });
                if (saved) setEndingLesson(null);
              }}
            >
              确认结课
            </Button>
            <Button onClick={() => setEndingLesson(null)} variant="outline">
              暂不结课
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingMutation(null);
            setConflicts([]);
          }
        }}
        open={Boolean(pendingMutation)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>确认取消冲突预约</DialogTitle>
            <DialogDescription>
              固定鼓课优先于个人预约。请先通过以下联系方式完成沟通，再确认取消。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {conflicts.map((conflict) => (
              <div
                className="rounded-xl border bg-muted/35 p-3 text-sm"
                key={conflict.id}
              >
                <p className="font-bold">{conflict.memberName}</p>
                <p className="mt-1 text-muted-foreground">
                  {conflict.date} · {SLOTS[conflict.slotIndex]}
                </p>
                {conflict.contact && (
                  <p className="mt-1 text-muted-foreground">
                    电话：{conflict.contact.phone}　微信：
                    {conflict.contact.wechat}
                  </p>
                )}
              </div>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input
              checked={communicationConfirmed}
              className="mt-1 size-4"
              onChange={(event) =>
                setCommunicationConfirmed(event.target.checked)
              }
              type="checkbox"
            />
            我确认已经与上述预约者完成沟通
          </label>
          <label
            className="grid gap-1.5 text-sm font-semibold"
            htmlFor="lesson-cancellation-reason"
          >
            取消原因
            <Input
              maxLength={200}
              id="lesson-cancellation-reason"
              onChange={(event) => setCancellationReason(event.target.value)}
              placeholder="例如：固定鼓课安排，已与预约者确认"
              value={cancellationReason}
            />
          </label>
          <DialogFooter>
            <Button
              disabled={
                loading || !communicationConfirmed || !cancellationReason.trim()
              }
              onClick={() => void confirmConflictCancellation()}
              variant="destructive"
            >
              确认取消预约并保存鼓课
            </Button>
            <Button onClick={() => setPendingMutation(null)} variant="outline">
              返回调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
