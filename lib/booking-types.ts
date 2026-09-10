import type { PracticeMode } from '@/lib/practice';

export type Booking = {
  id: string;
  date: string;
  slotIndex: number;
  memberName: string;
  entryType: 'booking' | 'activity' | 'lesson';
  practiceMode: PracticeMode;
  lessonId: string | null;
  createdAt: string;
  isOwn: boolean;
  canCancel: boolean;
  contact: { phone: string; wechat: string } | null;
};
