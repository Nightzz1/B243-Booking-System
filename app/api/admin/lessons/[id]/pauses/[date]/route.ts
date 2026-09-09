import { canManageActivities, getAuthUser } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';
import {
  getLessons,
  lessonErrorResponse,
  parseConflictConfirmation,
  pauseLesson,
  resumeLesson,
} from '@/lib/lessons';
import { getBookingPolicy } from '@/lib/schedule';

export const runtime = 'nodejs';

function validId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

async function manager(request: Request) {
  const user = await getAuthUser(request);
  return user && canManageActivities(user) ? user : null;
}

async function responseLessons() {
  const policy = await getBookingPolicy();
  return json({ lessons: await getLessons(policy) });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; date: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const { id, date } = await context.params;
  if (!validId(id)) return json({ error: '课程编号格式不正确。' }, 400);

  try {
    const user = await manager(request);
    if (!user) return json({ error: '没有固定鼓课管理权限。' }, 403);
    await pauseLesson(id, date, user.id);
    return await responseLessons();
  } catch (error) {
    const known = lessonErrorResponse(error);
    if (known) return json(known.body, known.status);
    console.error('Failed to pause drum lesson', error);
    return json({ error: '停课设置失败，请稍后重试。' }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; date: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const { id, date } = await context.params;
  if (!validId(id)) return json({ error: '课程编号格式不正确。' }, 400);
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  try {
    const user = await manager(request);
    if (!user) return json({ error: '没有固定鼓课管理权限。' }, 403);
    await resumeLesson(id, date, user, parseConflictConfirmation(body));
    return await responseLessons();
  } catch (error) {
    const known = lessonErrorResponse(error);
    if (known) return json(known.body, known.status);
    console.error('Failed to resume drum lesson', error);
    return json({ error: '恢复上课失败，请稍后重试。' }, 500);
  }
}
