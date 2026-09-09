import { canManageActivities, getAuthUser } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';
import { endLesson, getLessons, lessonErrorResponse } from '@/lib/lessons';
import { getBookingPolicy } from '@/lib/schedule';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  let body: { lastOccurrenceDate?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return json({ error: '课程编号格式不正确。' }, 400);
  }

  try {
    const user = await getAuthUser(request);
    if (!user || !canManageActivities(user)) {
      return json({ error: '没有固定鼓课管理权限。' }, 403);
    }
    const lastOccurrenceDate =
      typeof body.lastOccurrenceDate === 'string'
        ? body.lastOccurrenceDate
        : '';
    await endLesson(id, lastOccurrenceDate);
    const policy = await getBookingPolicy();
    return json({ lessons: await getLessons(policy) });
  } catch (error) {
    const known = lessonErrorResponse(error);
    if (known) return json(known.body, known.status);
    console.error('Failed to end drum lesson', error);
    return json({ error: '课程结课设置失败，请稍后重试。' }, 500);
  }
}
