import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function testRequestSecurity(pool) {
  const { isSameOriginMutation, readJsonBody } = await import('../lib/http.ts');
  const { limitSensitiveMutation } = await import('../lib/auth-rate-limit.ts');
  const names = [
    'APP_ORIGINS',
    'AUTH_TRUST_PROXY',
    'WRITE_ACCOUNT_LIMIT',
    'WRITE_CREDENTIAL_LIMIT',
    'WRITE_IP_LIMIT',
  ];
  const saved = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  const req = (origin, extra = {}) =>
    new Request('https://booking.test/api/bookings', {
      headers: { origin, ...extra },
    });
  try {
    process.env.APP_ORIGINS = 'https://booking.test';
    assert.ok(isSameOriginMutation(req('https://booking.test')));
    assert.equal(isSameOriginMutation(req('http://booking.test')), false);
    assert.equal(
      isSameOriginMutation(
        req('https://evil.test', {
          'x-forwarded-host': 'evil.test',
          host: 'evil.test',
        }),
      ),
      false,
    );
    delete process.env.APP_ORIGINS;
    process.env.AUTH_TRUST_PROXY = 'true';
    assert.equal(isSameOriginMutation(req('https://booking.test')), false);
    process.env.AUTH_TRUST_PROXY = 'false';
    assert.ok(isSameOriginMutation(req('https://booking.test')));
    assert.equal(
      isSameOriginMutation(
        req('https://evil.test', { 'x-forwarded-host': 'evil.test' }),
      ),
      false,
    );
    for (const body of ['null', '[]', '{']) {
      assert.equal(
        (
          await readJsonBody(
            new Request('http://localhost', { method: 'POST', body }),
          )
        ).status,
        400,
      );
    }
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(' '.repeat(9000)));
        controller.close();
      },
    });
    const oversized = await readJsonBody(
      new Request('http://localhost', {
        method: 'POST',
        body: stream,
        duplex: 'half',
        headers: { 'content-length': '1' },
      }),
    );
    assert.equal(oversized.status, 413);
    assert.deepEqual(
      await readJsonBody(
        new Request('http://localhost', {
          method: 'POST',
          body: '{"ok":true}',
        }),
      ),
      { ok: true },
    );
    await pool.query('DELETE FROM auth_rate_limits');
    process.env.WRITE_ACCOUNT_LIMIT = '2';
    process.env.WRITE_CREDENTIAL_LIMIT = '1';
    process.env.WRITE_IP_LIMIT = '100';
    process.env.AUTH_TRUST_PROXY = 'true';
    const request = req('https://booking.test', {
      'x-booking-client-ip': '192.0.2.1',
    });
    const id = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => limitSensitiveMutation(request, id)),
    );
    assert.equal(results.filter((item) => item === null).length, 2);
    assert.ok(
      results
        .filter(Boolean)
        .every(
          (item) =>
            item.status === 429 && Number(item.headers.get('retry-after')) > 0,
        ),
    );
    assert.equal(await limitSensitiveMutation(request, randomUUID()), null);
    assert.equal(await limitSensitiveMutation(request, id, true), null);
    assert.equal((await limitSensitiveMutation(request, id, true)).status, 429);
    await pool.query('DELETE FROM auth_rate_limits');
    process.env.WRITE_IP_LIMIT = '1';
    assert.equal(await limitSensitiveMutation(request, randomUUID()), null);
    assert.equal(
      (await limitSensitiveMutation(request, randomUUID())).status,
      429,
    );
    console.log(
      'PASS strict origins, forwarded-header rejection, streamed size limits, concurrent write limits and shared-IP budgets',
    );
  } finally {
    for (const key of names) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
  if (process.env.APP_DB_PASSWORD && process.env.BACKUP_DB_PASSWORD) {
    const { configureDatabaseRoles } = await import('./database-roles.mjs');
    const client = await pool.connect();
    try {
      await client.query(
        'CREATE TABLE IF NOT EXISTS _app_migrations (filename text PRIMARY KEY)',
      );
      await configureDatabaseRoles(client);
      async function forbidden(role, sql) {
        await client.query('BEGIN');
        try {
          await client.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(
            client.query(sql),
            (error) => error.code === '42501',
          );
        } finally {
          await client.query('ROLLBACK');
        }
      }
      await forbidden(
        'booking_app',
        'CREATE TABLE public.forbidden_table (id int)',
      );
      await forbidden('booking_app', 'DROP TABLE bookings');
      await forbidden('booking_app', 'DELETE FROM admin_audit_logs');
      await forbidden(
        'booking_app',
        'UPDATE admin_audit_logs SET target=target',
      );
      await forbidden('booking_app', 'SELECT * FROM _app_migrations');
      await forbidden('booking_backup', 'DELETE FROM bookings');
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE booking_app');
      await client.query('SELECT * FROM users LIMIT 1');
      await client.query(
        'UPDATE users SET display_name=display_name WHERE false',
      );
      await client.query(
        "INSERT INTO admin_audit_logs (id, actor_id, actor_account, actor_name, action, target) VALUES ($1,$2,'test','test','test','test')",
        [randomUUID(), randomUUID()],
      );
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE booking_backup');
      await client.query('SELECT * FROM admin_audit_logs LIMIT 1');
      await client.query('ROLLBACK');
      console.log(
        'PASS runtime DML, append-only audit, denied DDL and read-only backup permissions',
      );
    } finally {
      client.release();
    }
  }
}
