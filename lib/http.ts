export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function isSameOriginMutation(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const originHost = new URL(origin).host.toLowerCase();
    const forwardedHost = request.headers
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim();
    const requestHost =
      forwardedHost ?? request.headers.get('host') ?? new URL(request.url).host;
    return originHost === requestHost.toLowerCase();
  } catch {
    return false;
  }
}

export function mutationOriginError(request: Request) {
  return isSameOriginMutation(request)
    ? null
    : json({ error: '请求来源验证失败，请刷新页面后重试。' }, 403);
}
