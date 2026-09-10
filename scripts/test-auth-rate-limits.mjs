import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Runs inside the disposable database owned by test-member-features.mjs.
export async function testAuthRateLimits(pool, auth, hash) {
  const names = [
    'AUTH_TRUST_PROXY',
    'AUTH_LOGIN_ACCOUNT_LIMIT',
    'AUTH_LOGIN_IP_LIMIT',
    'AUTH_REGISTER_IP_LIMIT',
    'SYSTEM_ADMIN_ACCOUNT',
    'SYSTEM_ADMIN_PASSWORD',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    AUTH_TRUST_PROXY: 'true',
    AUTH_LOGIN_ACCOUNT_LIMIT: '3',
    AUTH_LOGIN_IP_LIMIT: '20',
    AUTH_REGISTER_IP_LIMIT: '3',
    SYSTEM_ADMIN_ACCOUNT: 'test_system_admin',
    SYSTEM_ADMIN_PASSWORD: 'original-password-123',
  });
  try {
    const login = await import('../app/api/auth/login/route.ts');
    const register = await import('../app/api/auth/register/route.ts');
    const limiter = await import('../lib/auth-rate-limit.ts');
    const password = 'original-password-123';
    for (const account of ['throttle_member', 'throttle_other']) {
      await pool.query(
        "INSERT INTO users (id, account, password_hash, display_name, contact, phone, wechat, role, status) VALUES ($1, $2, $3, '限流测试', '12345678', '12345678', 'test', 'member', 'approved')",
        [randomUUID(), account, hash],
      );
    }
    const request = (body, ip = '192.0.2.1', extras = {}) =>
      new Request('https://booking.test/api/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://booking.test',
          host: 'booking.test',
          'x-booking-client-ip': ip,
          'Content-Type': 'application/json',
          ...extras,
        },
        body: JSON.stringify(body),
      });
    const valid = { account: 'throttle_member', password };
    const wrong = { ...valid, password: 'incorrect-password' };
    assert.equal((await login.POST(request(wrong))).status, 401);
    assert.equal((await login.POST(request(wrong))).status, 401);
    for (let i = 0; i < 3; i++)
      assert.equal((await login.POST(request(valid))).status, 200);
    assert.equal(
      (await login.POST(request({ ...wrong, account: ' THROTTLE_MEMBER ' })))
        .status,
      401,
    );
    const blocked = await login.POST(request(valid));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal(
      (await login.POST(request({ account: 'throttle_other', password })))
        .status,
      200,
    );
    assert.equal((await login.POST(request(valid, '192.0.2.2'))).status, 429);
    const before = (
      await pool.query(
        'SELECT blocked_until::text AS deadline FROM auth_rate_limits WHERE blocked_until IS NOT NULL',
      )
    ).rows;
    await login.POST(request(valid, '192.0.2.3'));
    assert.deepEqual(
      (
        await pool.query(
          'SELECT blocked_until::text AS deadline FROM auth_rate_limits WHERE blocked_until IS NOT NULL',
        )
      ).rows,
      before,
    );
    await pool.query(
      "UPDATE auth_rate_limits SET blocked_until = now() - interval '1 second' WHERE blocked_until IS NOT NULL",
    );
    assert.equal((await login.POST(request(valid))).status, 200);
    console.log(
      'PASS account failure budget, successful login refunds, shared-campus IP and fixed cooldown',
    );

    await pool.query('DELETE FROM auth_rate_limits');
    const concurrent = await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.reserveLoginAttempt('parallel-account'),
      ),
    );
    assert.equal(
      concurrent.filter((value) => !(value instanceof Response)).length,
      3,
    );
    assert.equal(
      concurrent.filter(
        (value) => value instanceof Response && value.status === 429,
      ).length,
      9,
    );
    const old = concurrent.find((value) => !(value instanceof Response));
    await pool.query(
      "UPDATE auth_rate_limits SET expires_at = now() - interval '1 second', blocked_until = now() - interval '1 second'",
    );
    const fresh = await limiter.reserveLoginAttempt('parallel-account');
    assert.ok(!(fresh instanceof Response));
    await limiter.releaseLoginAttempt(old);
    assert.equal(
      (
        await pool.query('SELECT hits FROM auth_rate_limits WHERE key = $1', [
          fresh.key,
        ])
      ).rows[0].hits,
      1,
    );
    console.log(
      'PASS atomic parallel admission, cooldown recovery and stale-request isolation',
    );

    await pool.query('DELETE FROM auth_rate_limits');
    for (let i = 0; i < 20; i++)
      assert.equal((await login.POST(request({}))).status, 400);
    assert.equal(
      (
        await login.POST(
          request({}, '192.0.2.1', {
            'x-forwarded-for': '203.0.113.100',
            'x-real-ip': '203.0.113.101',
          }),
        )
      ).status,
      429,
    );
    assert.equal((await login.POST(request({}, '192.0.2.2'))).status, 400);
    assert.equal(
      limiter.clientIpKey(
        request({}, '2001:0db8:0001:0002:0000:0000:0000:0001'),
      ),
      limiter.clientIpKey(request({}, '2001:db8:1:2::abcd')),
    );
    assert.equal(
      limiter.clientIpKey(request({}, '::ffff:192.0.2.1')),
      limiter.clientIpKey(request({}, '192.0.2.1')),
    );
    assert.throws(() => limiter.clientIpKey(request({}, 'invalid')));
    process.env.AUTH_TRUST_PROXY = 'false';
    assert.equal(
      limiter.clientIpKey(request({}, '192.0.2.1')),
      limiter.clientIpKey(request({}, '192.0.2.2')),
    );
    process.env.AUTH_TRUST_PROXY = 'true';
    console.log(
      'PASS IP budget, forwarded-header spoof resistance and IPv6 normalization',
    );

    await pool.query('DELETE FROM auth_rate_limits');
    const registration = {
      password,
      displayName: '注册测试',
      phone: '13800138000',
      wechat: 'test_wechat',
    };
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await register.POST(
            request({ ...registration, account: `rate_register_${i}` }),
          )
        ).status,
        201,
      );
    assert.equal(
      (
        await register.POST(
          request({ ...registration, account: 'rate_register_blocked' }),
        )
      ).status,
      429,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*) FROM users WHERE account = 'rate_register_blocked'",
        )
      ).rows[0].count,
      '0',
    );
    assert.equal((await login.POST(request(valid))).status, 200);
    assert.equal((await register.POST(request(null, '192.0.2.9'))).status, 400);
    assert.equal(
      (await login.POST(request({ account: 'x'.repeat(9000) }, '192.0.2.9')))
        .status,
      413,
    );
    assert.equal(
      (await register.POST(request({ account: 'x'.repeat(9000) }, '192.0.2.9')))
        .status,
      413,
    );
    console.log(
      'PASS separate registration budget, blocked writes and bounded request bodies',
    );
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}
