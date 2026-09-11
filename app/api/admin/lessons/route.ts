import { mutationRateError } from '@/lib/mutation-guard';
import { readJsonBody } from '@/lib/http';
import { canManageActivities, getAuthUser } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';
import {
  createLesson,
  getLessons,
  lessonErrorResponse,
  parseConflictConfirmation,
  validateLessonInput,
} from '@/lib/lessons';
import { getBookingPolicy } from '@/lib/schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function lessonManager(request: Request) {
  const user = await getAuthUser(request);
  return user && canManageActivities(user) ? user : null;
}

export async function GET(request: Request) {
  try {
    const user = await lessonManager(request);
    if (!user) return json({ error: '没有固定鼓课管理权限。' }, 403);
    const policy = await getBookingPolicy();
    return json({ lessons: await getLessons(policy), settings: policy });
  } catch (error) {
    console.error('Failed to load drum lessons', error);
    return json({ error: '固定鼓课暂时无法加载。' }, 500);
  }
}

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const rateError = await mutationRateError(request);
  if (rateError) return rateError;

  const body = await readJsonBody(request, 65536);
  if (body instanceof Response) return body;

  try {
    const user = await lessonManager(request);
    if (!user) return json({ error: '没有固定鼓课管理权限。' }, 403);
    const policy = await getBookingPolicy();
    const input = validateLessonInput(body, policy);
    const id = await createLesson(
      input,
      policy,
      user,
      parseConflictConfirmation(body),
    );
    return json({ id, lessons: await getLessons(policy) }, 201);
  } catch (error) {
    const known = lessonErrorResponse(error);
    if (known) return json(known.body, known.status);
    console.error('Failed to create drum lesson', error);
    return json({ error: '固定鼓课保存失败，请稍后重试。' }, 500);
  }
}
