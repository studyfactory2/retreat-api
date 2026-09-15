import type { Role } from '@prisma/client';
import type { ListDto } from '../common/list';

export interface AssignedPropertyDto {
  id: string;
  name: string;
  region: string | null;
  isActive: boolean;
}

export interface StaffDto {
  id: string;
  name: string;
  role: typeof Role.STAFF;
  phone: string | null;
  company: string | null;
  department: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  assignedProperties: AssignedPropertyDto[];
}

export type StaffListDto = ListDto<StaffDto>;
