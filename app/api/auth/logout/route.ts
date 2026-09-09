import { clearSessionCookie, deleteSession } from '@/lib/auth';
import { json, mutationOriginError } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  try {
    await deleteSession(request);
    return Response.json(
      { message: '已退出登录。' },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': clearSessionCookie(request),
        },
      },
    );
  } catch (error) {
    console.error('Failed to log out', error);
    return json({ error: '退出登录失败，请稍后重试。' }, 500);
  }
}
