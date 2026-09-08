import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const bookings = sqliteTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    bookingDate: text('booking_date').notNull(),
    slotIndex: integer('slot_index').notNull(),
    memberName: text('member_name').notNull(),
    createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_bookings_date_slot_unique').on(
      table.bookingDate,
      table.slotIndex,
    ),
  ],
);
