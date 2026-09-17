import type { ListDto } from '../common/list';

export interface AdminIssueCategoryDto {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  isFallback: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type AdminIssueCategoryListDto = ListDto<AdminIssueCategoryDto>;
