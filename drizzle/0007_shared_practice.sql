-- Preserve existing reservations and all activity/lesson occupancy as exclusive.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD COLUMN practice_mode varchar(8) NOT NULL DEFAULT 'solo';
ALTER TABLE bookings ADD CONSTRAINT bookings_practice_mode_valid
  CHECK (practice_mode IN ('shared', 'solo'));
ALTER TABLE bookings ADD CONSTRAINT bookings_nonpersonal_solo
  CHECK (entry_type = 'booking' OR practice_mode = 'solo');

DROP INDEX idx_bookings_date_slot_unique;
CREATE UNIQUE INDEX idx_bookings_solo_date_slot_unique
  ON bookings (booking_date, slot_index) WHERE practice_mode = 'solo';
CREATE UNIQUE INDEX idx_bookings_personal_user_slot_unique
  ON bookings (booking_date, slot_index, user_id) WHERE entry_type = 'booking';
-- Same date/slot may contain shared rows OR one solo row, never both.
ALTER TABLE bookings ADD CONSTRAINT bookings_slot_practice_mode_exclusive
  EXCLUDE USING gist (booking_date WITH =, slot_index WITH =, practice_mode WITH <>);
