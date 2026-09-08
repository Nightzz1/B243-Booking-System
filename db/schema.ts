import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey(),
    bookingDate: date('booking_date', { mode: 'string' }).notNull(),
    slotIndex: integer('slot_index').notNull(),
    memberName: varchar('member_name', { length: 20 }).notNull(),
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
    check(
      'bookings_slot_index_range',
      sql`${table.slotIndex} BETWEEN 0 AND 9`,
    ),
    check(
      'bookings_member_name_nonempty',
      sql`char_length(btrim(${table.memberName})) BETWEEN 1 AND 20`,
    ),
  ],
);
