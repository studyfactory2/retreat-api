export interface PropertyGuidePdfMetadata {
  filename: string;
  sizeBytes: number;
}

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
    type: 'TEXT' | 'PDF';
    pdf: PropertyGuidePdfMetadata | null;
    isPublished: boolean;
    version: number;
    updatedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}
