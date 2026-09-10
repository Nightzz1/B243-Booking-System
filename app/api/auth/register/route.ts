import {
  hashPassword,
  isValidAccount,
  isValidPassword,
  isValidPhone,
  isValidWechat,
  normalizeAccount,
} from '@/lib/auth';
import { getPool } from '@/db';
import { limitAuthIp } from '@/lib/auth-rate-limit';
import { json, mutationOriginError, readAuthJson } from '@/lib/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;

  try {
    const limited = await limitAuthIp(request, 'register');
    if (limited) return limited;
  } catch (error) {
    console.error('Registration rate limiter unavailable', error);
    return json({ error: '注册服务暂时不可用，请稍后重试。' }, 503);
  }
  const body = await readAuthJson(request);
  if (body instanceof Response) return body;

  const account =
    typeof body.account === 'string' ? normalizeAccount(body.account) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const wechat = typeof body.wechat === 'string' ? body.wechat.trim() : '';

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
  if (!isValidPhone(phone)) {
    return json({ error: '请输入有效的电话号码（至少包含 6 位数字）。' }, 400);
  }
  if (!isValidWechat(wechat)) {
    return json({ error: '微信号需为 1–64 个字符。' }, 400);
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
         (id, account, password_hash, display_name, contact, phone, wechat,
          role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'member', 'pending')`,
      [
        crypto.randomUUID(),
        account,
        passwordHash,
        displayName,
        `${phone} / ${wechat}`,
        phone,
        wechat,
      ],
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
