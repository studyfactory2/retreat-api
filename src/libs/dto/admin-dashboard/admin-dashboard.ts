import type { MaintenanceSummaryDto } from '../admin-maintenance/admin-maintenance';

export interface DashboardChecklistCounts {
  scheduled: number;
  notSubmitted: number;
  submitted: number;
  needsReview: number;
  total: number;
}

export interface AdminDashboardDto {
  date: string;
  today: string;
  timezone: 'Asia/Seoul';
  asOf: Date;
  stays: {
    arrivals: number;
    departures: number;
  };
  checklists: {
    checkIn: DashboardChecklistCounts;
    checkOut: DashboardChecklistCounts;
  };
  maintenance: MaintenanceSummaryDto;
  issues: {
    new: number;
    inProgress: number;
    total: number;
  };
}
