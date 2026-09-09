import {
  clearSessionCookie,
  refreshAuthSession,
  sessionCookie,
} from '@/lib/auth';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await refreshAuthSession(request);
    if (!session) {
      return Response.json(
        { user: null },
        {
          headers: {
            'Cache-Control': 'no-store',
            'Set-Cookie': clearSessionCookie(request),
          },
        },
      );
    }

    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (session.renewal) {
      headers['Set-Cookie'] = sessionCookie(
        request,
        session.renewal.token,
        session.renewal.cookieExpiresAt,
      );
    }
    return Response.json({ user: session.user }, { headers });
  } catch (error) {
    console.error('Failed to load current user', error);
    return json({ error: '账号状态暂时无法加载。' }, 500);
  }
}
