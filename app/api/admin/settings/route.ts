import { canManageActivities, getAuthUser } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';
import {
  getBookingPolicy,
  isoWeekday,
  isRealDate,
  saveBookingPolicy,
} from '@/lib/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function settingsManager(request: Request) {
  const user = await getAuthUser(request);
  return user && canManageActivities(user) ? user : null;
}

export async function GET(request: Request) {
  try {
    const user = await settingsManager(request);
    if (!user) return json({ error: '没有预约设置管理权限。' }, 403);
    return json({ settings: await getBookingPolicy() });
  } catch (error) {
    console.error('Failed to load booking settings', error);
    return json({ error: '预约设置暂时无法加载。' }, 500);
  }
}

export async function PATCH(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  let body: { semesterStart?: unknown; semesterEnd?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  const semesterStart =
    typeof body.semesterStart === 'string' ? body.semesterStart : '';
  const semesterEnd =
    typeof body.semesterEnd === 'string' ? body.semesterEnd : '';
  if (
    !isRealDate(semesterStart) ||
    !isRealDate(semesterEnd) ||
    semesterStart > semesterEnd
  ) {
    return json({ error: '请提供有效的学期开始和结束日期。' }, 400);
  }
  if (isoWeekday(semesterStart) !== 1 || isoWeekday(semesterEnd) !== 7) {
    return json({ error: '学期必须从周一开始，并在周日结束。' }, 400);
  }
  const durationDays =
    (Date.parse(`${semesterEnd}T00:00:00Z`) -
      Date.parse(`${semesterStart}T00:00:00Z`)) /
    86_400_000;
  if (durationDays > 370) {
    return json({ error: '一个学期的设置范围不能超过 371 天。' }, 400);
  }

  try {
    const user = await settingsManager(request);
    if (!user) return json({ error: '没有预约设置管理权限。' }, 403);
    return json({
      settings: await saveBookingPolicy(semesterStart, semesterEnd, user.id),
    });
  } catch (error) {
    console.error('Failed to update booking settings', error);
    return json({ error: '预约设置保存失败，请稍后重试。' }, 500);
  }
}
