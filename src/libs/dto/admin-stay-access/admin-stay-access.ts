import type {
  PropertyRoomCodeMode,
  StayAccessCodeAction,
  StayAccessCodeMethod,
  StayStatus,
} from '@prisma/client';

export type AccessCodeReviewReason =
  | 'PHONE_CHANGED'
  | 'GUEST_CHANGED'
  | 'RESTORED'
  | 'PROPERTY_MODE_CHANGED'
  | 'FIXED_CODE_CHANGED'
  | 'NEIGHBOR_CODE_CONFLICT'
  | 'SOURCE_UNAVAILABLE';
export type AccessCodeBlockedReason =
  | 'CANCELLED'
  | 'ENDED'
  | 'PROPERTY_INACTIVE'
  | 'PROPERTY_UNCONFIGURED'
  | 'FIXED_CODE_MISSING';

export interface AdminStayAccessDto {
  stay: {
    id: string;
    propertyId: string;
    currentRevision: number;
    status: StayStatus;
    checkOutAt: Date;
    propertyIsActive: boolean;
  };
  propertySettings: {
    version: number;
    roomMode: PropertyRoomCodeMode | null;
    hasFixedRoomCode: boolean;
  };
  state: 'UNSET' | 'PREPARED' | 'REVIEW_REQUIRED';
  blockedReason: AccessCodeBlockedReason | null;
  phoneEligible: boolean;
  reviewReasons: AccessCodeReviewReason[];
  code: {
    version: number;
    method: StayAccessCodeMethod;
    preparedAt: Date;
    updatedAt: Date;
    sourceStayRevision: number;
    sourceSettingsVersion: number;
    phoneMatchesCurrent: boolean | null;
  } | null;
  canConfirm: boolean;
  history: {
    version: number;
    action: StayAccessCodeAction;
    method: StayAccessCodeMethod;
    actorName: string;
    createdAt: Date;
  }[];
}

export interface RevealedStayAccessCodeDto {
  stayId: string;
  code: string;
  version: number;
}
export enum SaveStayAccessAction {
  PREPARE = 'PREPARE',
  REPLACE = 'REPLACE',
  CONFIRM = 'CONFIRM',
}
