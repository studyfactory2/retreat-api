export interface DraftPhotoLimitsDto {
  maxBytes: number;
  maxPhotos: number;
  acceptedTypes: string[];
}

export interface DraftPhotoDto {
  id: string;
  status: 'READY';
  filename: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: Date;
}

export interface DraftPhotoListDto {
  items: DraftPhotoDto[];
  limits: DraftPhotoLimitsDto;
}

export interface DraftPhotoViewDto {
  url: string;
  expiresAt: Date;
}

export interface RemovedDraftPhotoDto {
  id: string;
  status: 'DELETED';
}
