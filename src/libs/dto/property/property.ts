import type { ListDto } from '../common/list';

export interface PropertyStaffDto {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
}

export interface PropertyDto {
  id: string;
  name: string;
  region: string | null;
  isActive: boolean;
  staffUserId: string | null;
  staff: PropertyStaffDto | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PropertyListDto = ListDto<PropertyDto>;
