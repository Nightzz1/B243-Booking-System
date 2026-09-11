import { mutationRateError } from '@/lib/mutation-guard';
import { readJsonBody } from '@/lib/http';
import { canManageActivities, getAuthUser } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';
import {
  deleteLesson,
  getLessons,
  lessonErrorResponse,
  parseConflictConfirmation,
  updateLesson,
  validateLessonInput,
} from '@/lib/lessons';
import { getBookingPolicy } from '@/lib/schedule';

export const runtime = 'nodejs';

function validId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

async function lessonManager(request: Request) {
  const user = await getAuthUser(request);
  return user && canManageActivities(user) ? user : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const rateError = await mutationRateError(request);
  if (rateError) return rateError;
  const body = await readJsonBody(request, 65536);
  if (body instanceof Response) return body;

  const { id } = await context.params;
  if (!validId(id)) return json({ error: '课程编号格式不正确。' }, 400);

  try {
    const user = await lessonManager(request);
    if (!user) return json({ error: '没有固定鼓课管理权限。' }, 403);
    const policy = await getBookingPolicy();
    await updateLesson(
      id,
      validateLessonInput(body, policy),
      policy,
      user,
      parseConflictConfirmation(body),
    );
    return json({ lessons: await getLessons(policy) });
  } catch (error) {
    const known = lessonErrorResponse(error);
    if (known) return json(known.body, known.status);
    console.error('Failed to update drum lesson', error);
    return json({ error: '固定鼓课修改失败，请稍后重试。' }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const rateError = await mutationRateError(request);
  if (rateError) return rateError;
  const { id } = await context.params;
  if (!validId(id)) return json({ error: '课程编号格式不正确。' }, 400);

  try {
    const user = await lessonManager(request);
    if (!user) return json({ error: '没有固定鼓课管理权限。' }, 403);
    await deleteLesson(id, user.id);
    return json({ deleted: true, id });
  } catch (error) {
    const known = lessonErrorResponse(error);
    if (known) return json(known.body, known.status);
    console.error('Failed to delete drum lesson', error);
    return json({ error: '固定鼓课删除失败，请稍后重试。' }, 500);
  }
}
