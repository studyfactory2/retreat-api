import type { ListDto } from '../common/list';

export type CalendarReviewReason =
  | 'DUPLICATE_SUBMISSIONS'
  | 'STAY_CHANGED'
  | 'VISIT_DATE_MISMATCH'
  | 'MISSING_MATCH_CONTEXT'
  | 'INVALID_SUBMISSION_RECORD';

export type CalendarChecklistStatus =
  'SCHEDULED' | 'NOT_SUBMITTED' | 'SUBMITTED' | 'NEEDS_REVIEW';

export interface CalendarChecklistDto {
  type: 'CHECK_IN' | 'CHECK_OUT';
  expectedDate: string;
  status: CalendarChecklistStatus;
  submissionCount: number;
  submissionId: string | null;
  reviewReasons: CalendarReviewReason[];
}

export interface AdminCalendarStayDto {
  id: string;
  property: {
    id: string;
    name: string;
    region: string | null;
    isActive: boolean;
  };
  guestName: string;
  checkInAt: Date;
  checkOutAt: Date;
  currentRevision: number;
  checkIn: CalendarChecklistDto;
  checkOut: CalendarChecklistDto;
}

export interface AdminCalendarDto extends ListDto<AdminCalendarStayDto> {
  from: string;
  to: string;
  timezone: 'Asia/Seoul';
  asOf: Date;
  today: string;
}
