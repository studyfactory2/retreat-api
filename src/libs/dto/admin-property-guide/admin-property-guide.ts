export interface AdminPropertyGuideDto {
  property: {
    id: string;
    name: string;
    region: string | null;
    isActive: boolean;
  };
  guide: {
    title: string;
    content: string;
    isPublished: boolean;
    version: number;
    updatedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}
