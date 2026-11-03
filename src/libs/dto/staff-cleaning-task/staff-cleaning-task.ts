export interface TaskPasswordDto {
  taskId: string;
  fingerprint: string;
  kind: 'NEXT_STAY' | 'VACANCY' | 'FIXED' | 'BLOCKED';
  canComplete: boolean;
  blockedReason: string | null;
  nextCheckInAt: Date | null;
  requiresChange: boolean;
}

export interface RevealedTaskPasswordDto {
  code: string;
  fingerprint: string;
}
