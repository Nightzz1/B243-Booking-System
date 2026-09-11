import { getAuthUser } from '@/lib/auth';
import { getPool } from '@/db';
import { json } from '@/lib/http';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (user?.role !== 'system_admin')
      return json({ error: '只有系统管理员可以查看管理操作记录。' }, 403);
    const page = Number(new URL(request.url).searchParams.get('page') ?? 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000)
      return json({ error: '页码无效。' }, 400);
    const result = await getPool().query(
      `SELECT id, created_at, actor_account, actor_name, action, target, details FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET $1`,
      [page * 50],
    );
    return json({
      logs: result.rows.slice(0, 50),
      hasMore: result.rows.length > 50,
    });
  } catch {
    return json({ error: '操作记录加载失败。' }, 500);
  }
}
