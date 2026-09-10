import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run only within the disposable database created by test-member-features.mjs.
export async function testSharedPractice(pool, auth, hash) {
  const route = await import('../app/api/bookings/route.ts');
  const mine = await import('../app/api/bookings/mine/route.ts');
  const cancel = await import('../app/api/bookings/[id]/route.ts');
  const activities = await import('../app/api/activities/route.ts');
  const lessons = await import('../lib/lessons.ts');
  const schedule = await import('../lib/schedule.ts');
  await pool.query('DELETE FROM bookings');
  const current = schedule.weekRange(schedule.shanghaiNow().date);
  await schedule.getBookingPolicy();
  await pool.query(
    'UPDATE booking_settings SET semester_start = $1, semester_end = $2',
    [current.from, schedule.addDateDays(current.to, 7)],
  );
  const policy = await schedule.getBookingPolicy();
  const candidates = [];
  for (let i = 0; i < 14; i++) {
    const date = schedule.addDateDays(current.from, i);
    for (const slot of schedule.slotsForDate(date, policy)) {
      if (
        !slot.isPublic &&
        schedule.isBookingOpen(date) &&
        !schedule.hasSlotStarted(date, slot.slotIndex)
      )
        candidates.push({ date, slotIndex: slot.slotIndex });
    }
  }
  const week = [current.from, schedule.addDateDays(current.from, 7)].find(
    (from) =>
      candidates.filter((slot) => schedule.weekRange(slot.date).from === from)
        .length >= 10,
  );
  assert.ok(week, 'Need at least ten open future slots in one week');
  const slots = candidates.filter(
    (slot) => schedule.weekRange(slot.date).from === week,
  );
  let number = 0;
  async function member() {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO users (id, account, password_hash, display_name, contact, phone, wechat, role, status) VALUES ($1, $2, $3, $4, '12345678 / test', '12345678', 'test', 'member', 'approved')",
      [id, `shared_test_${number}`, hash, `参与者${number++}`],
    );
    const session = await auth.createSession(id, hash);
    return { id, token: session.token };
  }
  const adminId = (
    await pool.query("SELECT id FROM users WHERE role = 'system_admin'")
  ).rows[0].id;
  const adminSession = await auth.createSession(adminId, hash);
  const admin = { id: adminId, token: adminSession.token };
  function request(
    user,
    body,
    method = 'POST',
    url = 'https://booking.test/api/bookings',
  ) {
    return new Request(url, {
      method,
      headers: {
        origin: 'https://booking.test',
        host: 'booking.test',
        cookie: `${auth.SESSION_COOKIE_NAME}=${user.token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const post = (user, selection) =>
    route.POST(request(user, { slots: selection }));
  const remove = (user, id) =>
    cancel.DELETE(request(user, undefined, 'DELETE'), {
      params: Promise.resolve({ id }),
    });
  const rowsAt = async (slot) =>
    (
      await pool.query(
        'SELECT id, user_id, practice_mode, entry_type FROM bookings WHERE booking_date = $1 AND slot_index = $2',
        [slot.date, slot.slotIndex],
      )
    ).rows;

  const [a, b, c] = await Promise.all([member(), member(), member()]);
  const shared = await Promise.all([post(a, [slots[0]]), post(b, [slots[0]])]);
  assert.deepEqual(
    shared.map((response) => response.status),
    [201, 201],
  );
  const entries = await rowsAt(slots[0]);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.practice_mode === 'shared'));
  const listing = await (
    await route.GET(
      request(
        a,
        undefined,
        'GET',
        `https://booking.test/api/bookings?from=${week}&to=${schedule.addDateDays(week, 6)}`,
      ),
    )
  ).json();
  assert.equal(listing.bookings.length, 2);
  assert.equal(listing.weeklyBookedCount, 1);
  assert.equal(listing.bookings.filter((entry) => entry.isOwn).length, 1);
  assert.equal(
    listing.bookings.find((entry) => !entry.isOwn).contact.phone,
    '12345678',
  );
  const own = await (await mine.GET(request(a, undefined, 'GET'))).json();
  assert.equal(
    own.weeks.flatMap((value) => value.bookings)[0].practiceMode,
    'shared',
  );
  assert.equal((await post(a, [slots[0]])).status, 409);
  assert.equal(
    (await post(c, [{ ...slots[0], practiceMode: 'solo' }, slots[1]])).status,
    409,
  );
  assert.equal(
    (await rowsAt(slots[1])).length,
    0,
    'Multi-slot insert must roll back entirely',
  );
  assert.equal(
    (
      await activities.POST(
        request(admin, { title: '冲突活动', slots: [slots[0]] }),
      )
    ).status,
    409,
  );
  assert.equal((await post(a, [slots[1]])).status, 201);
  assert.equal(
    (await post(a, [slots[2]])).status,
    409,
    'Shared slots must consume the weekly quota',
  );
  assert.equal((await remove(c, entries[0].id)).status, 403);
  assert.equal(
    (await remove(a, entries.find((entry) => entry.user_id === a.id).id))
      .status,
    200,
  );
  assert.equal((await rowsAt(slots[0])).length, 1);
  assert.equal(
    (await post(c, [{ ...slots[0], practiceMode: 'solo' }])).status,
    409,
  );
  assert.equal(
    (await remove(b, entries.find((entry) => entry.user_id === b.id).id))
      .status,
    200,
  );
  assert.equal(
    (await post(c, [{ ...slots[0], practiceMode: 'solo' }])).status,
    201,
  );
  assert.equal((await post(b, [slots[0]])).status, 409);
  assert.equal(
    (await post(b, [{ ...slots[0], practiceMode: 'solo' }])).status,
    409,
  );
  assert.equal((await rowsAt(slots[0]))[0].practice_mode, 'solo');
  console.log(
    'PASS shared joins, participant list, duplicate prevention, quotas, atomic writes and independent cancellation',
  );

  const [d, e] = await Promise.all([member(), member()]);
  const race = await Promise.all([
    post(d, [slots[3]]),
    post(e, [{ ...slots[3], practiceMode: 'solo' }]),
  ]);
  assert.deepEqual(race.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await rowsAt(slots[3])).length, 1);
  const [f, g] = await Promise.all([member(), member()]);
  const soloRace = await Promise.all([
    post(f, [{ ...slots[4], practiceMode: 'solo' }]),
    post(g, [{ ...slots[4], practiceMode: 'solo' }]),
  ]);
  assert.deepEqual(
    soloRace.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal(
    (
      await activities.POST(
        request(admin, { title: '正常活动', slots: [slots[5]] }),
      )
    ).status,
    201,
  );
  const h = await member();
  assert.equal((await post(h, [slots[5]])).status, 409);
  assert.equal(
    (await post(h, [{ ...slots[6], practiceMode: 'invalid' }])).status,
    400,
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO bookings (id, booking_date, slot_index, member_name, entry_type, practice_mode) VALUES ($1, $2, $3, '非法共享活动', 'activity', 'shared')",
      [randomUUID(), slots[6].date, slots[6].slotIndex],
    ),
    (error) => error.code === '23514',
  );
  console.log(
    'PASS concurrent shared/solo exclusion, solo exclusivity and activity isolation',
  );

  // Cover lesson takeover when another participant joins after the initial conflict preview.
  await pool.query('DELETE FROM bookings');
  const pair = slots.find(
    (slot) =>
      slot.slotIndex <= 11 &&
      slots.some(
        (next) =>
          next.date === slot.date && next.slotIndex === slot.slotIndex + 1,
      ),
  );
  assert.ok(pair);
  const [i, j, k] = await Promise.all([member(), member(), member()]);
  assert.equal((await post(i, [pair])).status, 201);
  assert.equal((await post(j, [pair])).status, 201);
  const adminUser = await auth.getAuthUser(request(admin, undefined, 'GET'));
  const input = {
    className: '共享冲突测试',
    startWeek: schedule.weekRange(pair.date).from,
    weekday: schedule.isoWeekday(pair.date),
    firstSlotIndex: pair.slotIndex,
  };
  let conflicts;
  await assert.rejects(
    lessons.createLesson(input, policy, adminUser),
    (error) => {
      conflicts = error.details.conflicts;
      return error.status === 409 && conflicts.length === 2;
    },
  );
  assert.equal((await post(k, [pair])).status, 201);
  const confirmation = {
    communicationConfirmed: true,
    confirmedConflictIds: conflicts.map((entry) => entry.id),
    cancellationReason: '已联系参与者调整时间',
  };
  await assert.rejects(
    lessons.createLesson(input, policy, adminUser, confirmation),
    (error) => error.status === 409 && error.details.conflicts.length === 3,
  );
  const all = await rowsAt(pair);
  await assert.rejects(
    lessons.createLesson(input, policy, adminUser, {
      ...confirmation,
      confirmedConflictIds: [all[0].id, all[0].id, all[0].id],
    }),
    (error) => error.status === 409,
  );
  const lessonId = await lessons.createLesson(input, policy, adminUser, {
    ...confirmation,
    confirmedConflictIds: all.map((entry) => entry.id),
  });
  assert.ok(
    (await rowsAt(pair)).every(
      (entry) =>
        entry.entry_type === 'lesson' && entry.practice_mode === 'solo',
    ),
  );
  assert.equal(
    (
      await pool.query(
        'SELECT count(*) FROM lesson_cancellation_audits WHERE lesson_id = $1',
        [lessonId],
      )
    ).rows[0].count,
    '3',
  );
  assert.equal((await post(i, [pair])).status, 409);
  console.log(
    'PASS complete shared-participant lesson confirmation, changed conflicts and per-person audit records',
  );
}
