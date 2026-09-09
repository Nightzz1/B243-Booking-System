import {
  hashPassword,
  isValidAccount,
  isValidPassword,
  normalizeAccount,
} from '@/lib/auth';
import { getPool } from '@/db';
import { json, mutationOriginError } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  let body: {
    account?: unknown;
    password?: unknown;
    displayName?: unknown;
    contact?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求内容格式不正确。' }, 400);
  }

  const account =
    typeof body.account === 'string' ? normalizeAccount(body.account) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';

  if (!isValidAccount(account)) {
    return json(
      { error: '学号/工号需为 3–32 位字母、数字、下划线或连字符。' },
      400,
    );
  }
  if (!isValidPassword(password)) {
    return json({ error: '密码长度需为 8–128 个字符。' }, 400);
  }
  if (!displayName || displayName.length > 40) {
    return json({ error: '姓名需为 1–40 个字符。' }, 400);
  }
  if (!contact || contact.length > 100) {
    return json({ error: '联系方式需为 1–100 个字符。' }, 400);
  }
  if (
    process.env.SYSTEM_ADMIN_ACCOUNT &&
    account === normalizeAccount(process.env.SYSTEM_ADMIN_ACCOUNT)
  ) {
    return json({ error: '该账号由系统保留，不能注册。' }, 409);
  }

  try {
    const passwordHash = await hashPassword(password);
    await getPool().query(
      `INSERT INTO users
         (id, account, password_hash, display_name, contact, role, status)
       VALUES ($1, $2, $3, $4, $5, 'member', 'pending')`,
      [crypto.randomUUID(), account, passwordHash, displayName, contact],
    );
    return json(
      { message: '注册申请已提交，请等待系统管理员或鼓房管理员审核。' },
      201,
    );
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === '23505') {
      return json({ error: '该学号/工号已经注册。' }, 409);
    }
    console.error('Failed to register user', error);
    return json({ error: '注册暂时失败，请稍后重试。' }, 500);
  }
}
