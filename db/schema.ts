import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', [
  'system_admin',
  'club_admin',
  'member',
]);

export const userStatus = pgEnum('user_status', [
  'pending',
  'approved',
  'rejected',
]);

export const scheduleEntryType = pgEnum('schedule_entry_type', [
  'booking',
  'activity',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    account: varchar('account', { length: 32 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    contact: varchar('contact', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    wechat: varchar('wechat', { length: 64 }),
    role: userRole('role').default('member').notNull(),
    status: userStatus('status').default('pending').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_account_unique').on(table.account),
    uniqueIndex('idx_users_single_system_admin')
      .on(table.role)
      .where(sql`${table.role} = 'system_admin'`),
    index('idx_users_status_created').on(table.status, table.createdAt),
    check('users_account_format', sql`${table.account} ~ '^[a-z0-9_-]{3,32}$'`),
    check(
      'users_display_name_nonempty',
      sql`char_length(btrim(${table.displayName})) BETWEEN 1 AND 40`,
    ),
    check(
      'users_contact_nonempty',
      sql`char_length(btrim(${table.contact})) BETWEEN 1 AND 100`,
    ),
    check(
      'users_phone_nonempty',
      sql`${table.phone} IS NULL OR char_length(btrim(${table.phone})) BETWEEN 1 AND 32`,
    ),
    check(
      'users_wechat_nonempty',
      sql`${table.wechat} IS NULL OR char_length(btrim(${table.wechat})) BETWEEN 1 AND 64`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_sessions_token_hash_unique').on(table.tokenHash),
    index('idx_sessions_user').on(table.userId),
    index('idx_sessions_expires').on(table.expiresAt),
  ],
);

export const bookingSettings = pgTable(
  'booking_settings',
  {
    id: varchar('id', { length: 16 }).primaryKey(),
    semesterStart: date('semester_start', { mode: 'string' }).notNull(),
    semesterEnd: date('semester_end', { mode: 'string' }).notNull(),
    lastPrunedWeek: date('last_pruned_week', { mode: 'string' }),
    updatedBy: uuid('updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'booking_settings_semester_range',
      sql`${table.semesterEnd} >= ${table.semesterStart}`,
    ),
    check(
      'booking_settings_semester_start_monday',
      sql`extract(isodow from ${table.semesterStart}) = 1`,
    ),
    check(
      'booking_settings_semester_end_sunday',
      sql`extract(isodow from ${table.semesterEnd}) = 7`,
    ),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey(),
    bookingDate: date('booking_date', { mode: 'string' }).notNull(),
    slotIndex: integer('slot_index').notNull(),
    memberName: varchar('member_name', { length: 80 }).notNull(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    entryType: scheduleEntryType('entry_type').default('booking').notNull(),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_bookings_date_slot_unique').on(
      table.bookingDate,
      table.slotIndex,
    ),
    index('idx_bookings_user_date').on(table.userId, table.bookingDate),
    check(
      'bookings_slot_index_range',
      sql`${table.slotIndex} BETWEEN 0 AND 12`,
    ),
    check(
      'bookings_member_name_nonempty',
      sql`char_length(btrim(${table.memberName})) BETWEEN 1 AND 80`,
    ),
  ],
);
