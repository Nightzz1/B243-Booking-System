import { recordAdminAction } from '@/lib/admin-audit';
import type { PoolClient } from 'pg';

import { getPool } from '@/db';
import type { AuthUser } from '@/lib/auth';
import {
  addDateDays,
  type BookingPolicy,
  getBookingPolicy,
  hasSlotStarted,
  isoWeekday,
  isRealDate,
  slotForDate,
  weekRange,
} from '@/lib/schedule';

export type LessonInput = {
  className: string;
  startWeek: string;
  weekday: number;
  firstSlotIndex: number;
};

export type ConflictConfirmation = {
  communicationConfirmed: boolean;
  confirmedConflictIds: string[];
  cancellationReason: string;
};

export type LessonConflict = {
  id: string;
  date: string;
  slotIndex: number;
  memberName: string;
  entryType: 'booking' | 'activity' | 'lesson';
  contact: { phone: string; wechat: string } | null;
};

export type LessonOccurrence = {
  date: string;
  paused: boolean;
  started: boolean;
};

export type DrumLesson = LessonInput & {
  id: string;
  semesterStart: string;
  semesterEnd: string;
  lastOccurrenceDate: string | null;
  createdAt: string;
  updatedAt: string;
  hasStarted: boolean;
  canDelete: boolean;
  occurrences: LessonOccurrence[];
};

type LessonRow = {
  id: string;
  class_name: string;
  semester_start: string;
  semester_end: string;
  start_week: string;
  weekday: number;
  first_slot_index: number;
  last_occurrence_date: string | null;
  created_at: string;
  updated_at: string;
};

type EntryRow = {
  id: string;
  booking_date: string;
  slot_index: number;
  member_name: string;
  user_id: string | null;
  entry_type: 'booking' | 'activity' | 'lesson';
  phone: string | null;
  wechat: string | null;
};

export class LessonServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function lessonFromRow(row: LessonRow) {
  return {
    id: row.id,
    className: row.class_name,
    semesterStart: row.semester_start,
    semesterEnd: row.semester_end,
    startWeek: row.start_week,
    weekday: row.weekday,
    firstSlotIndex: row.first_slot_index,
    lastOccurrenceDate: row.last_occurrence_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function occurrenceDate(startWeek: string, weekday: number) {
  return addDateDays(startWeek, weekday - 1);
}

function occurrenceDates(
  lesson: Pick<
    LessonRow,
    'start_week' | 'weekday' | 'semester_end' | 'last_occurrence_date'
  >,
) {
  const end = lesson.last_occurrence_date ?? lesson.semester_end;
  const dates: string[] = [];
  for (
    let date = occurrenceDate(lesson.start_week, lesson.weekday);
    date <= end;
    date = addDateDays(date, 7)
  ) {
    dates.push(date);
  }
  return dates;
}

function isOccurrenceStarted(date: string, firstSlotIndex: number) {
  return hasSlotStarted(date, firstSlotIndex);
}

function requestedSlots(dates: string[], firstSlotIndex: number) {
  return dates.flatMap((date) => [
    { date, slotIndex: firstSlotIndex },
    { date, slotIndex: firstSlotIndex + 1 },
  ]);
}

function equalIdSets(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return (
    new Set(right).size === expected.size &&
    right.every((id) => expected.has(id))
  );
}

function toConflict(row: EntryRow): LessonConflict {
  return {
    id: row.id,
    date: row.booking_date,
    slotIndex: row.slot_index,
    memberName: row.member_name,
    entryType: row.entry_type,
    contact:
      row.entry_type === 'booking' && row.phone && row.wechat
        ? { phone: row.phone, wechat: row.wechat }
        : null,
  };
}

function placeholdersForSlots(
  slots: Array<{ date: string; slotIndex: number }>,
) {
  return slots
    .map((_, index) => `($${index * 2 + 1}::date, $${index * 2 + 2}::integer)`)
    .join(', ');
}

async function conflictingEntries(
  client: PoolClient,
  slots: Array<{ date: string; slotIndex: number }>,
  ownLessonId?: string,
) {
  if (slots.length === 0) return [];
  const values = slots.flatMap((slot) => [slot.date, slot.slotIndex]);
  values.push(ownLessonId ?? '00000000-0000-0000-0000-000000000000');
  const result = await client.query<EntryRow>(
    `WITH requested(booking_date, slot_index) AS (
       VALUES ${placeholdersForSlots(slots)}
     )
     SELECT b.id, b.booking_date::text AS booking_date, b.slot_index,
            b.member_name, b.user_id, b.entry_type,
            COALESCE(u.phone, u.contact) AS phone,
            COALESCE(u.wechat, u.contact) AS wechat
     FROM bookings b
     JOIN requested r
       ON r.booking_date = b.booking_date AND r.slot_index = b.slot_index
     LEFT JOIN users u ON u.id = b.user_id
     WHERE b.lesson_id IS DISTINCT FROM $${values.length}::uuid
     ORDER BY b.booking_date, b.slot_index
     FOR UPDATE OF b`,
    values,
  );
  return result.rows;
}

async function cancelConfirmedBookings(
  client: PoolClient,
  lessonId: string,
  userId: string,
  conflicts: EntryRow[],
  confirmation: ConflictConfirmation,
) {
  const personal = conflicts.filter((entry) => entry.entry_type === 'booking');
  const hard = conflicts.filter((entry) => entry.entry_type !== 'booking');
  if (hard.length > 0) {
    throw new LessonServiceError(
      '所选鼓课时间与其他鼓课或社团活动冲突，请先调整或移除冲突安排。',
      409,
      { hardConflicts: hard.map(toConflict) },
    );
  }
  if (personal.length === 0) return;

  const reason = confirmation.cancellationReason.trim();
  const conflictIds = personal.map((entry) => entry.id);
  if (
    !confirmation.communicationConfirmed ||
    reason.length < 1 ||
    reason.length > 200 ||
    !equalIdSets(conflictIds, confirmation.confirmedConflictIds)
  ) {
    throw new LessonServiceError(
      '该时间已有个人预约，请先完成沟通并确认取消。',
      409,
      {
        requiresConfirmation: true,
        conflicts: personal.map(toConflict),
      },
    );
  }

  const auditPlaceholders = personal
    .map(
      (_, index) =>
        `($${index * 9 + 1}::uuid, $${index * 9 + 2}::uuid, $${index * 9 + 3}::uuid, $${index * 9 + 4}::uuid, $${index * 9 + 5}, $${index * 9 + 6}::date, $${index * 9 + 7}, $${index * 9 + 8}::uuid, $${index * 9 + 9})`,
    )
    .join(', ');
  const auditValues = personal.flatMap((entry) => [
    crypto.randomUUID(),
    lessonId,
    entry.id,
    entry.user_id,
    entry.member_name,
    entry.booking_date,
    entry.slot_index,
    userId,
    reason,
  ]);
  await client.query(
    `INSERT INTO lesson_cancellation_audits
       (id, lesson_id, booking_id, booking_user_id, booking_member_name,
        booking_date, slot_index, cancelled_by, reason)
     VALUES ${auditPlaceholders}`,
    auditValues,
  );
  await client.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [
    conflictIds,
  ]);
}

async function insertLessonEntries(
  client: PoolClient,
  lessonId: string,
  className: string,
  userId: string,
  slots: Array<{ date: string; slotIndex: number }>,
) {
  if (slots.length === 0) return;
  const placeholders = slots
    .map(
      (_, index) =>
        `($${index * 6 + 1}::uuid, $${index * 6 + 2}::date, $${index * 6 + 3}, $${index * 6 + 4}, $${index * 6 + 5}::uuid, 'lesson', $${index * 6 + 6}::uuid)`,
    )
    .join(', ');
  const values = slots.flatMap((slot) => [
    crypto.randomUUID(),
    slot.date,
    slot.slotIndex,
    className,
    userId,
    lessonId,
  ]);
  await client.query(
    `INSERT INTO bookings
       (id, booking_date, slot_index, member_name, user_id, entry_type, lesson_id)
     VALUES ${placeholders}`,
    values,
  );
}

async function claimLessonSlots(
  client: PoolClient,
  lessonId: string,
  className: string,
  userId: string,
  slots: Array<{ date: string; slotIndex: number }>,
  confirmation: ConflictConfirmation,
) {
  const conflicts = await conflictingEntries(client, slots, lessonId);
  await cancelConfirmedBookings(
    client,
    lessonId,
    userId,
    conflicts,
    confirmation,
  );
  await insertLessonEntries(client, lessonId, className, userId, slots);
}

function noConfirmation(): ConflictConfirmation {
  return {
    communicationConfirmed: false,
    confirmedConflictIds: [],
    cancellationReason: '',
  };
}

export function parseConflictConfirmation(
  value: Record<string, unknown>,
): ConflictConfirmation {
  return {
    communicationConfirmed: value.communicationConfirmed === true,
    confirmedConflictIds: Array.isArray(value.confirmedConflictIds)
      ? value.confirmedConflictIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : [],
    cancellationReason:
      typeof value.cancellationReason === 'string'
        ? value.cancellationReason
        : '',
  };
}

export function validateLessonInput(
  value: Record<string, unknown>,
  policy: BookingPolicy,
): LessonInput {
  const className =
    typeof value.className === 'string' ? value.className.trim() : '';
  const startWeek = typeof value.startWeek === 'string' ? value.startWeek : '';
  const weekday = Number(value.weekday);
  const firstSlotIndex = Number(value.firstSlotIndex);
  if (className.length < 1 || className.length > 80) {
    throw new LessonServiceError('班型名称需为 1–80 个字符。', 400);
  }
  if (
    !isRealDate(startWeek) ||
    isoWeekday(startWeek) !== 1 ||
    startWeek < policy.semesterStart ||
    startWeek > policy.semesterEnd
  ) {
    throw new LessonServiceError('开始周必须是当前学期内某一周的周一。', 400);
  }
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new LessonServiceError('请选择有效的上课星期。', 400);
  }
  if (
    !Number.isInteger(firstSlotIndex) ||
    firstSlotIndex < 0 ||
    firstSlotIndex > 11
  ) {
    throw new LessonServiceError('请选择连续两个有效节次。', 400);
  }
  const date = occurrenceDate(startWeek, weekday);
  const first = slotForDate(date, firstSlotIndex, policy);
  const second = slotForDate(date, firstSlotIndex + 1, policy);
  if (!first || !second || first.isPublic || second.isPublic) {
    throw new LessonServiceError(
      '鼓课只能安排在当前学期内连续两个非公用时段。',
      409,
    );
  }
  return { className, startWeek, weekday, firstSlotIndex };
}

async function lessonPauses(client: PoolClient, lessonIds: string[]) {
  if (lessonIds.length === 0) return new Map<string, Set<string>>();
  const result = await client.query<{
    lesson_id: string;
    pause_week: string;
  }>(
    `SELECT lesson_id, pause_week::text AS pause_week
     FROM drum_lesson_pauses
     WHERE lesson_id = ANY($1::uuid[])
     ORDER BY pause_week`,
    [lessonIds],
  );
  const pauses = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const set = pauses.get(row.lesson_id) ?? new Set<string>();
    set.add(row.pause_week);
    pauses.set(row.lesson_id, set);
  }
  return pauses;
}

function publicLesson(row: LessonRow, pauseWeeks: Set<string>): DrumLesson {
  const base = lessonFromRow(row);
  const occurrences = occurrenceDates(row).map((date) => ({
    date,
    paused: pauseWeeks.has(weekRange(date).from),
    started: isOccurrenceStarted(date, row.first_slot_index),
  }));
  const hasStarted = occurrences.some(
    (occurrence) => occurrence.started && !occurrence.paused,
  );
  return {
    ...base,
    hasStarted,
    canDelete: !hasStarted,
    occurrences,
  };
}

export async function getLessons(policy?: BookingPolicy) {
  const activePolicy = policy ?? (await getBookingPolicy());
  const client = await getPool().connect();
  try {
    const result = await client.query<LessonRow>(
      `SELECT id, class_name, semester_start::text AS semester_start,
              semester_end::text AS semester_end,
              start_week::text AS start_week, weekday, first_slot_index,
              last_occurrence_date::text AS last_occurrence_date,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM drum_lessons
       WHERE semester_start = $1::date AND semester_end = $2::date
       ORDER BY last_occurrence_date NULLS FIRST, start_week, weekday, first_slot_index`,
      [activePolicy.semesterStart, activePolicy.semesterEnd],
    );
    const pauses = await lessonPauses(
      client,
      result.rows.map((lesson) => lesson.id),
    );
    return result.rows.map((lesson) =>
      publicLesson(lesson, pauses.get(lesson.id) ?? new Set()),
    );
  } finally {
    client.release();
  }
}

async function lockedLesson(client: PoolClient, id: string) {
  const result = await client.query<LessonRow>(
    `SELECT id, class_name, semester_start::text AS semester_start,
            semester_end::text AS semester_end,
            start_week::text AS start_week, weekday, first_slot_index,
            last_occurrence_date::text AS last_occurrence_date,
            created_at::text AS created_at, updated_at::text AS updated_at
     FROM drum_lessons WHERE id = $1::uuid FOR UPDATE`,
    [id],
  );
  const lesson = result.rows[0];
  if (!lesson) throw new LessonServiceError('该鼓课不存在。', 404);
  return lesson;
}

async function pauseWeeksForLesson(client: PoolClient, lessonId: string) {
  return (await lessonPauses(client, [lessonId])).get(lessonId) ?? new Set();
}

function futureUnpausedDates(row: LessonRow, pauseWeeks: Set<string>) {
  return occurrenceDates(row).filter(
    (date) =>
      !isOccurrenceStarted(date, row.first_slot_index) &&
      !pauseWeeks.has(weekRange(date).from),
  );
}

function rethrowDatabaseConflict(error: unknown): never {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (code === '23505' || code === '23P01' || code === '40P01') {
    throw new LessonServiceError(
      '课程保存期间时段状态发生了变化，请刷新后重试。',
      409,
    );
  }
  throw error;
}

export async function createLesson(
  input: LessonInput,
  policy: BookingPolicy,
  user: AuthUser,
  confirmation = noConfirmation(),
) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const id = crypto.randomUUID();
    const result = await client.query<LessonRow>(
      `INSERT INTO drum_lessons
         (id, class_name, semester_start, semester_end, start_week,
          weekday, first_slot_index, created_by)
       VALUES ($1::uuid, $2, $3::date, $4::date, $5::date, $6, $7, $8::uuid)
       RETURNING id, class_name, semester_start::text AS semester_start,
                 semester_end::text AS semester_end,
                 start_week::text AS start_week, weekday, first_slot_index,
                 last_occurrence_date::text AS last_occurrence_date,
                 created_at::text AS created_at, updated_at::text AS updated_at`,
      [
        id,
        input.className,
        policy.semesterStart,
        policy.semesterEnd,
        input.startWeek,
        input.weekday,
        input.firstSlotIndex,
        user.id,
      ],
    );
    const lesson = result.rows[0];
    const dates = futureUnpausedDates(lesson, new Set());
    if (dates.length === 0) {
      throw new LessonServiceError(
        '该设置在本学期内已没有尚未开始的课程。',
        409,
      );
    }
    await claimLessonSlots(
      client,
      id,
      input.className,
      user.id,
      requestedSlots(dates, input.firstSlotIndex),
      confirmation,
    );
    await recordAdminAction(client, user.id, 'lesson.create', id, input);
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof LessonServiceError) throw error;
    rethrowDatabaseConflict(error);
  } finally {
    client.release();
  }
}

export async function updateLesson(
  id: string,
  input: LessonInput,
  policy: BookingPolicy,
  user: AuthUser,
  confirmation = noConfirmation(),
) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const current = await lockedLesson(client, id);
    if (current.last_occurrence_date) {
      throw new LessonServiceError('已经结课的课程不能再修改。', 409);
    }
    if (
      current.semester_start !== policy.semesterStart ||
      current.semester_end !== policy.semesterEnd
    ) {
      throw new LessonServiceError('该课程不属于当前学期。', 409);
    }

    const existing = await client.query<{
      id: string;
      booking_date: string;
    }>(
      `SELECT id, booking_date::text AS booking_date
       FROM bookings WHERE lesson_id = $1::uuid AND entry_type = 'lesson'
       FOR UPDATE`,
      [id],
    );
    const preservedWeeks = new Set(
      existing.rows
        .filter((entry) =>
          isOccurrenceStarted(entry.booking_date, current.first_slot_index),
        )
        .map((entry) => weekRange(entry.booking_date).from),
    );
    const removableIds = existing.rows
      .filter(
        (entry) =>
          !isOccurrenceStarted(entry.booking_date, current.first_slot_index),
      )
      .map((entry) => entry.id);
    if (removableIds.length > 0) {
      await client.query('DELETE FROM bookings WHERE id = ANY($1::uuid[])', [
        removableIds,
      ]);
    }
    const result = await client.query<LessonRow>(
      `UPDATE drum_lessons
       SET class_name = $2, start_week = $3::date, weekday = $4,
           first_slot_index = $5, updated_at = now()
       WHERE id = $1::uuid
       RETURNING id, class_name, semester_start::text AS semester_start,
                 semester_end::text AS semester_end,
                 start_week::text AS start_week, weekday, first_slot_index,
                 last_occurrence_date::text AS last_occurrence_date,
                 created_at::text AS created_at, updated_at::text AS updated_at`,
      [
        id,
        input.className,
        input.startWeek,
        input.weekday,
        input.firstSlotIndex,
      ],
    );
    const updated = result.rows[0];
    const pauses = await pauseWeeksForLesson(client, id);
    const dates = futureUnpausedDates(updated, pauses).filter(
      (date) => !preservedWeeks.has(weekRange(date).from),
    );
    await claimLessonSlots(
      client,
      id,
      input.className,
      user.id,
      requestedSlots(dates, input.firstSlotIndex),
      confirmation,
    );
    await recordAdminAction(client, user.id, 'lesson.update', id, input);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof LessonServiceError) throw error;
    rethrowDatabaseConflict(error);
  } finally {
    client.release();
  }
}

export async function deleteLesson(id: string, userId: string) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const lesson = await lockedLesson(client, id);
    const pauses = await pauseWeeksForLesson(client, id);
    const hasStarted = occurrenceDates(lesson).some(
      (date) =>
        !pauses.has(weekRange(date).from) &&
        isOccurrenceStarted(date, lesson.first_slot_index),
    );
    if (hasStarted) {
      throw new LessonServiceError(
        '该课程已经上过课，请使用“结束课程”保留历史记录。',
        409,
      );
    }
    await client.query('DELETE FROM bookings WHERE lesson_id = $1::uuid', [id]);
    await client.query('DELETE FROM drum_lessons WHERE id = $1::uuid', [id]);
    await recordAdminAction(client, userId, 'lesson.delete', id, {
      className: lesson.class_name,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function assertOccurrence(lesson: LessonRow, date: string) {
  if (
    !isRealDate(date) ||
    isoWeekday(date) !== lesson.weekday ||
    date < occurrenceDate(lesson.start_week, lesson.weekday) ||
    date > (lesson.last_occurrence_date ?? lesson.semester_end)
  ) {
    throw new LessonServiceError('所选日期不是该课程的有效上课日期。', 400);
  }
}

export async function endLesson(
  id: string,
  lastOccurrenceDate: string,
  userId: string,
) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const lesson = await lockedLesson(client, id);
    if (lesson.last_occurrence_date) {
      throw new LessonServiceError('该课程已经结课。', 409);
    }
    assertOccurrence(lesson, lastOccurrenceDate);
    const pauses = await pauseWeeksForLesson(client, id);
    if (pauses.has(weekRange(lastOccurrenceDate).from)) {
      throw new LessonServiceError('停课周不能作为最后一次实际上课日期。', 409);
    }
    if (!isOccurrenceStarted(lastOccurrenceDate, lesson.first_slot_index)) {
      throw new LessonServiceError(
        '只能选择已经开始的课程作为最后一次课。',
        409,
      );
    }
    const latestStarted = occurrenceDates(lesson)
      .filter(
        (date) =>
          !pauses.has(weekRange(date).from) &&
          isOccurrenceStarted(date, lesson.first_slot_index),
      )
      .at(-1);
    if (latestStarted && lastOccurrenceDate < latestStarted) {
      throw new LessonServiceError(
        `最后一次上课日期不能早于已经发生的 ${latestStarted}。`,
        409,
      );
    }
    await client.query(
      `DELETE FROM bookings
       WHERE lesson_id = $1::uuid AND entry_type = 'lesson'
         AND booking_date > $2::date`,
      [id, lastOccurrenceDate],
    );
    await client.query(
      `DELETE FROM drum_lesson_pauses
       WHERE lesson_id = $1::uuid AND pause_week > $2::date`,
      [id, weekRange(lastOccurrenceDate).from],
    );
    await client.query(
      `UPDATE drum_lessons
       SET last_occurrence_date = $2::date, updated_at = now()
       WHERE id = $1::uuid`,
      [id, lastOccurrenceDate],
    );
    await recordAdminAction(client, userId, 'lesson.end', id, {
      lastOccurrenceDate,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function pauseLesson(id: string, date: string, userId: string) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const lesson = await lockedLesson(client, id);
    if (lesson.last_occurrence_date) {
      throw new LessonServiceError('已经结课的课程不能再设置停课。', 409);
    }
    assertOccurrence(lesson, date);
    if (isOccurrenceStarted(date, lesson.first_slot_index)) {
      throw new LessonServiceError('已经开始或过去的鼓课不能停课。', 409);
    }
    const pauseWeek = weekRange(date).from;
    await client.query(
      `INSERT INTO drum_lesson_pauses (id, lesson_id, pause_week, created_by)
       VALUES ($1::uuid, $2::uuid, $3::date, $4::uuid)
       ON CONFLICT (lesson_id, pause_week) DO NOTHING`,
      [crypto.randomUUID(), id, pauseWeek, userId],
    );
    await client.query(
      `DELETE FROM bookings
       WHERE lesson_id = $1::uuid AND booking_date = $2::date
         AND entry_type = 'lesson'`,
      [id, date],
    );
    await recordAdminAction(client, userId, 'lesson.pause', id, { date });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resumeLesson(
  id: string,
  date: string,
  user: AuthUser,
  confirmation = noConfirmation(),
) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const lesson = await lockedLesson(client, id);
    if (lesson.last_occurrence_date) {
      throw new LessonServiceError('已经结课的课程不能再恢复上课。', 409);
    }
    assertOccurrence(lesson, date);
    if (isOccurrenceStarted(date, lesson.first_slot_index)) {
      throw new LessonServiceError('已经开始或过去的鼓课不能恢复。', 409);
    }
    const pauseWeek = weekRange(date).from;
    const pause = await client.query(
      `SELECT id FROM drum_lesson_pauses
       WHERE lesson_id = $1::uuid AND pause_week = $2::date FOR UPDATE`,
      [id, pauseWeek],
    );
    if (!pause.rows[0]) {
      throw new LessonServiceError('该周没有登记停课。', 404);
    }
    await client.query(
      `DELETE FROM drum_lesson_pauses
       WHERE lesson_id = $1::uuid AND pause_week = $2::date`,
      [id, pauseWeek],
    );
    await claimLessonSlots(
      client,
      id,
      lesson.class_name,
      user.id,
      requestedSlots([date], lesson.first_slot_index),
      confirmation,
    );
    await recordAdminAction(client, user.id, 'lesson.resume', id, { date });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof LessonServiceError) throw error;
    rethrowDatabaseConflict(error);
  } finally {
    client.release();
  }
}

export async function saveBookingPolicyWithLessons(
  semesterStart: string,
  semesterEnd: string,
  userId: string,
) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const settings = await client.query<{
      semester_start: string;
      semester_end: string;
    }>(
      `SELECT semester_start::text AS semester_start,
              semester_end::text AS semester_end
       FROM booking_settings WHERE id = 'default' FOR UPDATE`,
    );
    const current = settings.rows[0];
    if (!current) {
      throw new LessonServiceError('当前学期设置不存在。', 500);
    }
    const activeLessons = await client.query<LessonRow>(
      `SELECT id, class_name, semester_start::text AS semester_start,
              semester_end::text AS semester_end,
              start_week::text AS start_week, weekday, first_slot_index,
              last_occurrence_date::text AS last_occurrence_date,
              created_at::text AS created_at, updated_at::text AS updated_at
       FROM drum_lessons
       WHERE last_occurrence_date IS NULL
         AND semester_start = $1::date AND semester_end = $2::date
       ORDER BY start_week, weekday
       FOR UPDATE`,
      [current.semester_start, current.semester_end],
    );
    const truncated = activeLessons.rows.filter(
      (lesson) =>
        lesson.start_week < semesterStart || lesson.semester_end > semesterEnd,
    );
    if (truncated.length > 0) {
      throw new LessonServiceError(
        '新的学期范围会截断尚未结课的固定鼓课，请先完成结课或调整课程。',
        409,
        {
          lessons: truncated.map((lesson) => ({
            id: lesson.id,
            className: lesson.class_name,
          })),
        },
      );
    }

    for (const lesson of activeLessons.rows) {
      if (semesterEnd > lesson.semester_end) {
        const pauses = await pauseWeeksForLesson(client, lesson.id);
        const extended = { ...lesson, semester_end: semesterEnd };
        const dates = futureUnpausedDates(extended, pauses).filter(
          (date) => date > lesson.semester_end,
        );
        await claimLessonSlots(
          client,
          lesson.id,
          lesson.class_name,
          userId,
          requestedSlots(dates, lesson.first_slot_index),
          noConfirmation(),
        );
      }
      await client.query(
        `UPDATE drum_lessons
         SET semester_start = $2::date, semester_end = $3::date,
             updated_at = now()
         WHERE id = $1::uuid`,
        [lesson.id, semesterStart, semesterEnd],
      );
    }

    const result = await client.query<{
      semester_start: string;
      semester_end: string;
      updated_at: string;
    }>(
      `UPDATE booking_settings
       SET semester_start = $1::date, semester_end = $2::date,
           updated_by = $3::uuid, updated_at = now()
       WHERE id = 'default'
       RETURNING semester_start::text AS semester_start,
                 semester_end::text AS semester_end,
                 updated_at::text AS updated_at`,
      [semesterStart, semesterEnd, userId],
    );
    await recordAdminAction(client, userId, 'settings.semester', 'semester', {
      semesterStart,
      semesterEnd,
    });
    await client.query('COMMIT');
    return {
      semesterStart: result.rows[0].semester_start,
      semesterEnd: result.rows[0].semester_end,
      updatedAt: result.rows[0].updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof LessonServiceError) throw error;
    rethrowDatabaseConflict(error);
  } finally {
    client.release();
  }
}

export function lessonErrorResponse(error: unknown) {
  if (error instanceof LessonServiceError) {
    return {
      status: error.status,
      body: { error: error.message, ...error.details },
    };
  }
  return null;
}
