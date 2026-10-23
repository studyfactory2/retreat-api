import {
  GatewayTimeoutException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const MAX_ARCHIVE_PHOTOS = 100;
export const MAX_ARCHIVE_PHOTO_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_ZIP_BYTES = 128 * 1024 * 1024;
export const ARCHIVE_PREPARATION_MS = 80_000;
export const ARCHIVE_TRANSFER_MS = 180_000;

export interface PreservationArchivePhoto {
  id: string;
  propertyId: string;
  propertyName: string;
  originalFilename: string;
  status: string;
  deleted: boolean;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  storageBucket: string;
  storageKey: string;
}

export interface ArchivePhotoCounts {
  total: number;
  included: number;
  skipped: number;
}

export function archivePhotosTooLarge(): never {
  throw new PayloadTooLargeException({
    code: 'ARCHIVE_TOO_LARGE',
    message:
      '사진은 최대 100장·100 MiB, ZIP은 128 MiB까지 받을 수 있습니다. 기간이나 휴양소 범위를 줄여 주세요.',
  });
}

export function archiveTimedOut(): never {
  throw new GatewayTimeoutException({
    code: 'ARCHIVE_TIMEOUT',
    message:
      '파일 준비 시간이 초과되었습니다. 기간이나 휴양소 범위를 줄여 다시 시도해 주세요.',
  });
}

export function archivePhotoUnavailable(): never {
  throw new ServiceUnavailableException({
    code: 'ARCHIVE_PHOTO_UNAVAILABLE',
    message: '사진 파일을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  });
}
