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

export async function readAuthJson(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const maxBytes = 8192;
  if (Number(request.headers.get('content-length')) > maxBytes)
    return json({ error: '请求内容过大。' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '请求内容格式不正确。' }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => {});
        return json({ error: '请求内容过大。' }, 413);
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : json({ error: '请求内容格式不正确。' }, 400);
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  } finally {
    reader.releaseLock();
  }
}
