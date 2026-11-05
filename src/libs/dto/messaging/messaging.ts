import type {
  MessageDispatchMode,
  MessageDispatchStatus,
  MessageKind,
  MessageSubjectType,
} from '@prisma/client';

export interface MessagingBlocker {
  code: string;
  message: string;
}

export interface MessagingStatusDto {
  enabled: boolean;
  ready: boolean;
  channel: 'ALIMTALK';
  smsFallbackEnabled: false;
  reasons: MessagingBlocker[];
  templates: { kind: MessageKind; label: string; configured: boolean }[];
}

export interface MessageDispatchDto {
  id: string;
  subjectType: MessageSubjectType;
  subjectId: string;
  kind: MessageKind;
  mode: MessageDispatchMode;
  status: MessageDispatchStatus;
  maskedRecipient: string;
  createdAt: Date;
  updatedAt: Date;
  lastCheckedAt: Date | null;
  errorCode: string | null;
}

export interface MessagingSubjectDto {
  subjectType: MessageSubjectType;
  subjectId: string;
  availableKinds: MessageKind[];
  history: MessageDispatchDto[];
}

export interface MessagePreviewDto {
  subjectType: MessageSubjectType;
  subjectId: string;
  kind: MessageKind;
  label: string;
  channel: 'ALIMTALK';
  recipient: { name: string; maskedPhone: string | null };
  body: string;
  buttons: { label: string; url: string }[];
  previewKey: string;
  canSend: boolean;
  blockers: MessagingBlocker[];
  warnings: string[];
}
