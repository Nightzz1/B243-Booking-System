export const RETAINED_PAST_WEEKS = 3;
export const VISIBLE_FUTURE_WEEKS = 1;
export const ADMIN_VISIBLE_FUTURE_WEEKS = 16;
export const MIN_VISIBLE_WEEK_OFFSET = -RETAINED_PAST_WEEKS;
export const MAX_VISIBLE_WEEK_OFFSET = VISIBLE_FUTURE_WEEKS;
export const VISIBLE_WEEK_COUNT = 1 + VISIBLE_FUTURE_WEEKS;

export type BookingWindowRole = 'system_admin' | 'club_admin' | 'member';

export function minVisibleWeekOffsetForRole(role: BookingWindowRole) {
  return role === 'member' ? 0 : MIN_VISIBLE_WEEK_OFFSET;
}

export function maxVisibleWeekOffsetForRole(role: BookingWindowRole) {
  return role === 'member'
    ? MAX_VISIBLE_WEEK_OFFSET
    : ADMIN_VISIBLE_FUTURE_WEEKS;
}
