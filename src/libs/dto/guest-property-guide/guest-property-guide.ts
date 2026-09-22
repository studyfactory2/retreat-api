export interface PublishedPropertyGuideDto {
  title: string;
  content: string;
  version: number;
  updatedAt: Date;
}

export interface GuestPropertyGuideDto {
  property: {
    id: string;
    name: string;
    region: string | null;
  };
  guide: PublishedPropertyGuideDto | null;
}
