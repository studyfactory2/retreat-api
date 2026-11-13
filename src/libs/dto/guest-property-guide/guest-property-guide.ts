import type { PropertyGuidePdfMetadata } from '../admin-property-guide/admin-property-guide';

export interface GuestPropertyGuideDto {
  property: { id: string; name: string; region: string | null };
  guide: {
    title: string;
    content: string;
    type: 'TEXT' | 'PDF';
    pdf: PropertyGuidePdfMetadata | null;
    version: number;
    updatedAt: Date;
  } | null;
}
