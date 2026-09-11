import { getAuthUser } from '@/lib/auth';
import { limitSensitiveMutation } from '@/lib/auth-rate-limit';
import { json } from '@/lib/http';
export async function mutationRateError(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return null;
    const path = new URL(request.url).pathname;
    return await limitSensitiveMutation(
      request,
      user.id,
      path === '/api/account' || path.endsWith('/reset-password'),
    );
  } catch {
    return json({ error: '请求保护暂时不可用，请稍后重试。' }, 503);
  }
}
