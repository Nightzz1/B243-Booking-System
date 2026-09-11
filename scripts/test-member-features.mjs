// Integration tests use a newly created database; the configured application database is never modified.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
      const base = path.join(root, specifier.slice(2));
      return {
        url: pathToFileURL(
          existsSync(`${base}.ts`) ? `${base}.ts` : path.join(base, 'index.ts'),
        ).href,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (
      url.startsWith(pathToFileURL(root).href) &&
      url.endsWith('.ts') &&
      !url.includes('/node_modules/')
    ) {
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
        shortCircuit: true,
      };
    }
    return next(url, context);
  },
});

const connection = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? process.env.POSTGRES_PORT ?? 5432),
      user: process.env.PGUSER ?? process.env.POSTGRES_USER,
      password: process.env.PGPASSWORD ?? process.env.POSTGRES_PASSWORD,
      database: process.env.PGDATABASE ?? process.env.POSTGRES_DB,
    };
if (process.env.DB_SSL === 'true')
  connection.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
const admin = new pg.Pool({
  ...connection,
  max: 1,
  connectionTimeoutMillis: 5000,
});
const name = `member_test_${randomUUID().replaceAll('-', '')}`;
let pool;
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.href;
  } else process.env.PGDATABASE = name;
  ({ getPool: pool } = await import('../db/index.ts'));
  pool = pool();
  for (const file of readdirSync(path.join(root, 'drizzle'))
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    await pool.query(readFileSync(path.join(root, 'drizzle', file), 'utf8'));
  }
  const auth = await import('../lib/auth.ts');
  const schedule = await import('../lib/schedule.ts');
  const account = await import('../app/api/account/route.ts');
  const mine = await import('../app/api/bookings/mine/route.ts');
  const cancel = await import('../app/api/bookings/[id]/route.ts');
  const oldPassword = 'original-password-123';
  const newPassword = 'replacement-password-456';
  const hash = await auth.hashPassword(oldPassword);
  const users = [];
  for (const role of ['member', 'club_admin', 'system_admin']) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO users (id, account, password_hash, display_name, contact, phone, wechat, role, status) VALUES ($1, $2, $3, '测试社员', '12345678 / test', '12345678', 'test', $4, 'approved')",
      [id, `test_${role}`, hash, role],
    );
    const session = await auth.createSession(id, hash);
    users.push({ id, token: session.token });
  }
  function request(token, body, origin = 'https://booking.test') {
    return new Request('https://booking.test/api/account', {
      method: body === undefined ? 'GET' : 'PATCH',
      headers: {
        origin,
        host: 'booking.test',
        cookie: token ? `${auth.SESSION_COOKIE_NAME}=${token}` : '',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const profile = {
    action: 'profile',
    phone: '13800138000',
    wechat: 'updated_wechat',
  };
  assert.equal((await account.PATCH(request('', profile))).status, 401);
  assert.equal(
    (await account.PATCH(request(users[0].token, profile, 'https://evil.test')))
      .status,
    403,
  );
  assert.equal(
    (await account.PATCH(request(users[0].token, null))).status,
    400,
  );
  assert.equal(
    (await account.PATCH(request(users[0].token, { ...profile, phone: 'bad' })))
      .status,
    400,
  );
  assert.equal(
    (await account.PATCH(request(users[2].token, profile))).status,
    403,
  );
  for (const user of users.slice(0, 2)) {
    const response = await account.PATCH(
      request(user.token, {
        ...profile,
        userId: users[2].id,
        role: 'system_admin',
        account: 'hijacked',
      }),
    );
    assert.equal(response.status, 200);
    const updated = (await response.json()).user;
    assert.equal(updated.id, user.id);
    assert.equal(updated.phone, profile.phone);
    assert.notEqual(updated.role, 'system_admin');
    assert.notEqual(updated.account, 'hijacked');
  }
  assert.equal(
    (await auth.getAuthUser(request(users[2].token))).phone,
    '12345678',
  );
  console.log('PASS profile validation, CSRF, role restrictions and ownership');

  const week = schedule.weekRange(schedule.shanghaiNow().date);
  const nextDate = schedule.addDateDays(week.from, 7);
  const ownId = randomUUID();
  for (const [id, user, date, slot, type] of [
    [randomUUID(), users[0], week.from, 0, 'booking'],
    [ownId, users[0], nextDate, 1, 'booking'],
    [randomUUID(), users[1], nextDate, 2, 'booking'],
    [randomUUID(), users[0], nextDate, 3, 'activity'],
    [randomUUID(), users[0], schedule.addDateDays(week.from, -7), 0, 'booking'],
  ])
    await pool.query(
      'INSERT INTO bookings (id, user_id, booking_date, slot_index, member_name, entry_type) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, user.id, date, slot, '测试', type],
    );
  assert.equal((await mine.GET(request(''))).status, 401);
  let result = await (await mine.GET(request(users[0].token))).json();
  assert.deepEqual(
    result.weeks.map((entry) => entry.bookings.length),
    [1, 1],
  );
  assert.deepEqual(
    result.weeks.map((entry) => entry.remaining),
    [1, 1],
  );
  assert.equal(result.weeks[1].bookings[0].id, ownId);
  assert.equal(result.weeks[1].bookings[0].canCancel, true);
  assert.equal(
    (
      await cancel.DELETE(request(users[1].token), {
        params: Promise.resolve({ id: ownId }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await cancel.DELETE(request(users[0].token), {
        params: Promise.resolve({ id: ownId }),
      })
    ).status,
    200,
  );
  result = await (await mine.GET(request(users[0].token))).json();
  assert.equal(result.weeks[1].remaining, 2);
  console.log(
    'PASS own bookings, week quota, activity exclusion and cancellation ownership',
  );

  const passwordBody = {
    action: 'password',
    currentPassword: oldPassword,
    newPassword,
  };
  assert.equal(
    (
      await account.PATCH(
        request(users[0].token, {
          ...passwordBody,
          currentPassword: 'incorrect-password',
        }),
      )
    ).status,
    400,
  );
  assert.ok(await auth.getAuthUser(request(users[0].token)));
  const second = await auth.createSession(users[0].id, hash);
  await pool.query(
    "UPDATE sessions SET expires_at = now() + interval '1 hour' WHERE user_id = $1",
    [users[0].id],
  );
  const [changed] = await Promise.all([
    account.PATCH(request(users[0].token, passwordBody)),
    auth.refreshAuthSession(request(second.token)),
    auth.createSession(users[0].id, hash),
  ]);
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(
    Number(
      (
        await pool.query('SELECT count(*) FROM sessions WHERE user_id = $1', [
          users[0].id,
        ])
      ).rows[0].count,
    ),
    0,
  );
  assert.equal(await auth.getAuthUser(request(users[0].token)), null);
  assert.equal(await auth.getAuthUser(request(second.token)), null);
  assert.equal(await auth.createSession(users[0].id, hash), null);
  assert.equal(
    (await account.PATCH(request(users[0].token, profile))).status,
    401,
  );
  const updatedHash = (
    await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      users[0].id,
    ])
  ).rows[0].password_hash;
  assert.equal(await auth.verifyPassword(oldPassword, updatedHash), false);
  assert.equal(await auth.verifyPassword(newPassword, updatedHash), true);
  assert.ok(await auth.createSession(users[0].id, updatedHash));
  assert.ok(await auth.getAuthUser(request(users[1].token)));
  console.log(
    'PASS password verification, concurrent session revocation and new-password login',
  );
  const reset =
    await import('../app/api/admin/users/[id]/reset-password/route.ts');
  const context = { params: Promise.resolve({ id: users[0].id }) };
  assert.equal((await reset.POST(request(''), context)).status, 403);
  assert.equal(
    (await reset.POST(request(users[1].token), context)).status,
    403,
  );
  assert.equal(
    (
      await reset.POST(
        request(users[2].token, undefined, 'https://evil.test'),
        context,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await reset.POST(request(users[2].token), {
        params: Promise.resolve({ id: users[2].id }),
      })
    ).status,
    400,
  );
  await pool.query("UPDATE users SET status = 'pending' WHERE id = $1", [
    users[0].id,
  ]);
  assert.equal(
    (await reset.POST(request(users[2].token), context)).status,
    400,
  );
  await pool.query("UPDATE users SET status = 'approved' WHERE id = $1", [
    users[0].id,
  ]);
  const beforeResetSession = await auth.createSession(users[0].id, updatedHash);
  const resetResponse = await reset.POST(request(users[2].token), context);
  assert.equal(resetResponse.status, 200);
  assert.equal(resetResponse.headers.get('cache-control'), 'no-store');
  const resetPassword = (await resetResponse.json()).newPassword;
  assert.ok(auth.isValidPassword(resetPassword));
  assert.equal(await auth.getAuthUser(request(beforeResetSession.token)), null);
  assert.equal(await auth.createSession(users[0].id, updatedHash), null);
  const resetHash = (
    await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      users[0].id,
    ])
  ).rows[0].password_hash;
  assert.notEqual(resetHash, resetPassword);
  assert.equal(await auth.verifyPassword(resetPassword, resetHash), true);
  assert.equal(await auth.verifyPassword(newPassword, resetHash), false);
  // New password behaves like an ordinary password, including repeated logins.
  const resetLogin = await auth.createSession(users[0].id, resetHash);
  assert.ok(resetLogin);
  assert.ok(await auth.createSession(users[0].id, resetHash));
  assert.equal((await mine.GET(request(resetLogin.token))).status, 200);
  const changedAgain = await account.PATCH(
    request(resetLogin.token, {
      action: 'password',
      currentPassword: resetPassword,
      newPassword: 'member-chosen-password-789',
    }),
  );
  assert.equal(changedAgain.status, 200);
  const replacement = await reset.POST(request(users[2].token), context);
  assert.notEqual((await replacement.json()).newPassword, resetPassword);
  assert.ok(await auth.getAuthUser(request(users[2].token)));
  console.log(
    'PASS admin-only reset, session revocation, reusable new password and voluntary password change',
  );
  const management = await import('../app/api/admin/users/route.ts');
  for (const status of ['pending', 'rejected']) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO users (id, account, password_hash, display_name, contact, role, status) VALUES ($1, $2, $3, '审核测试', 'test', 'member', $4)",
      [id, `review_${status}`, hash, status],
    );
    const promotion = { userId: id, action: 'set_role', role: 'club_admin' };
    assert.equal(
      (await management.PATCH(request(users[2].token, promotion))).status,
      409,
    );
    assert.equal(
      (await pool.query('SELECT status FROM users WHERE id=$1', [id])).rows[0]
        .status,
      status,
    );
    assert.equal(
      (
        await management.PATCH(
          request(users[2].token, { userId: id, action: 'approve' }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await management.PATCH(request(users[1].token, promotion))).status,
      403,
    );
    assert.equal(
      (await management.PATCH(request(users[2].token, promotion))).status,
      200,
    );
    assert.equal(
      (
        await management.PATCH(
          request(users[2].token, { ...promotion, role: 'member' }),
        )
      ).status,
      200,
    );
    const saved = (
      await pool.query('SELECT role, status FROM users WHERE id=$1', [id])
    ).rows[0];
    assert.deepEqual(saved, { role: 'member', status: 'approved' });
  }
  const auditApi = await import('../app/api/admin/audit-logs/route.ts');
  assert.equal((await auditApi.GET(request(users[1].token))).status, 403);
  assert.equal((await auditApi.GET(request(''))).status, 403);
  const auditResponse = await auditApi.GET(request(users[2].token));
  assert.equal(auditResponse.status, 200);
  const auditBody = await auditResponse.json();
  assert.ok(
    auditBody.logs.some((entry) => entry.action === 'account.reset_password'),
  );
  assert.equal(
    auditBody.logs.filter((entry) => entry.action === 'account.set_role')
      .length,
    4,
  );
  assert.equal(JSON.stringify(auditBody).includes(resetPassword), false);
  const { recordAdminAction } = await import('../lib/admin-audit.ts');
  const auditClient = await pool.connect();
  try {
    await auditClient.query('BEGIN');
    await recordAdminAction(auditClient, users[2].id, 'test.rollback', 'test');
    await auditClient.query('ROLLBACK');
  } finally {
    auditClient.release();
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM admin_audit_logs WHERE action='test.rollback'",
      )
    ).rows[0].count,
    0,
  );
  console.log(
    'PASS administrator audit authorization, successful-only role records, secret exclusion and transaction rollback',
  );
  console.log(
    'PASS approved-only administrator assignment and system-admin-only role changes',
  );
  const { testAuthRateLimits } = await import('./test-auth-rate-limits.mjs');
  await testAuthRateLimits(pool, auth, hash);
  const { testSharedPractice } = await import('./test-shared-practice.mjs');
  await testSharedPractice(pool, auth, hash);
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
