import { ConflictException, PayloadTooLargeException } from '@nestjs/common';
import type {
  ArchiveFields,
  ArchiveSheetName,
  ArchiveTable,
  ArchiveValue,
} from '../../libs/dto/admin-report/preservation-report';

export const MAX_ARCHIVE_VERSIONS = 10_000;
export const MAX_ARCHIVE_ROWS = 50_000;
const MAX_ARCHIVE_TEXT_BYTES = 32 * 1024 * 1024;

export const archiveHeaders: Record<ArchiveSheetName, string[]> = {
  '이용 일정': [
    '휴양소',
    '이용객',
    '회사',
    '부서',
    '연락처',
    '입실 예정 (서울)',
    '퇴실 예정 (서울)',
    '상태',
    '메모',
    '취소 시각 (서울)',
    '취소 사유',
    '등록 경로',
    '지역',
    '일정 ID',
    '버전',
    '휴양소 ID',
  ],
  '점검 기록': [
    '휴양소',
    '구분',
    '방문일',
    '작성자',
    '회사',
    '부서',
    '연락처',
    '작성 경로',
    '작성 시작 (서울)',
    '최초 제출 (서울)',
    '상태',
    '전체 메모',
    '응답 수',
    '이상 응답 수',
    '사진 수',
    '취소 시각 (서울)',
    '체크리스트',
    '체크리스트 버전',
    '지역',
    '일정 ID',
    '제출 ID',
    '버전',
    '휴양소 ID',
  ],
  '점검 답변': [
    '휴양소',
    '구분',
    '섹션',
    '질문',
    '응답',
    '이상 내용',
    '긴급',
    '직원 조치 기록',
    '직원 조치 메모',
    '필수 항목',
    '제출 ID',
    '버전',
    '섹션 ID',
    '항목 ID',
  ],
  이상사항: [
    '휴양소',
    '제목',
    '내용',
    '분류',
    '위치',
    '긴급',
    '처리 상태',
    '기록 상태',
    '접수 시각 (서울)',
    '해결 시각 (서울)',
    '취소 시각 (서울)',
    '취소 사유',
    '지역',
    '연결 제출 ID',
    '연결 항목 ID',
    '이전 이상사항 ID',
    '이상사항 ID',
    '버전',
    '휴양소 ID',
  ],
  '변경 이력': [
    '기록 종류',
    '기록 ID',
    '버전',
    '변경 종류',
    '변경 시각 (서울)',
    '변경자',
    '역할',
    '경로',
    '사유 / 메모',
    '항목',
    '변경 전',
    '변경 후',
    '이력 ID',
    '변경자 ID',
  ],
  '사진 목록': [
    '기록 종류',
    '기록 ID',
    '버전',
    '현재 버전',
    '사진 ID',
    '파일명',
    '용도',
    '섹션 ID',
    '항목 ID',
    '위치',
    '정렬 순서',
    '파일 상태',
    '파일 형식',
    '크기 (바이트)',
    '등록 시각 (서울)',
    '이력 ID',
  ],
};

export const archiveLabels: Record<string, string> = {
  CHECK_IN: '입실',
  CHECK_OUT: '퇴실',
  MAINTENANCE: '정비',
  ACTIVE: '예약',
  CANCELLED: '취소됨',
  SUBMITTED: '제출됨',
  NEW: '신규 접수',
  IN_PROGRESS: '조치 중',
  RESOLVED: '조치 완료',
  NORMAL: '정상',
  ABNORMAL: '이상',
  CREATED: '최초 등록',
  CORRECTED: '내용 정정',
  RESTORED: '복원',
  REPORTED: '최초 신고',
  UPDATED: '내용 변경',
  STATUS_CHANGED: '상태 변경',
  REPAIR_REPORTED: '직원 조치 기록',
  REOPENED: '재접수',
  ADMIN: '관리자',
  STAFF: '직원',
  GUEST: '이용객',
  ADMIN_SESSION: '관리자',
  GUEST_QR: '이용객 QR',
  STAFF_QR: '직원 QR',
  PRIVATE_LINK: '개인 링크',
  SYSTEM: '시스템',
  MANUAL: '직접 등록',
  EXCEL: '엑셀',
  DEFECT: '이상 사진',
  REPAIR: '조치 사진',
  MAINTENANCE_BEFORE: '정비 전',
  MAINTENANCE_AFTER: '정비 후',
};

export function archiveLabel(value: string): string {
  return archiveLabels[value] ?? value;
}

export function archiveTooLarge(): never {
  throw new PayloadTooLargeException({
    code: 'REPORT_TOO_LARGE',
    message:
      '보관할 기록이나 이력이 너무 많습니다. 기간 또는 휴양소를 좁혀 주세요. 일부만 저장하지 않습니다.',
  });
}

export function archiveNeedsReview(): never {
  throw new ConflictException({
    code: 'REPORT_RECORD_NEEDS_REVIEW',
    message:
      '저장된 기록과 이력을 확인할 수 없습니다. 관리자 화면에서 기록을 확인해 주세요.',
  });
}

/** Bounds expanded rows/text before constructing the XLSX object graph. */
export class ArchiveTables {
  readonly tables: ArchiveTable[] = Object.entries(archiveHeaders).map(
    ([name, headers]) => ({
      name: name as ArchiveSheetName,
      headers,
      rows: [],
    }),
  );
  private rowCount = 0;
  private textBytes = 0;

  add(name: ArchiveSheetName, values: ArchiveValue[]): void {
    const table = this.tables.find((item) => item.name === name);
    if (values.length !== table.headers.length) archiveNeedsReview();
    for (const value of values) {
      if (typeof value === 'string') {
        // Excel limits each cell to 32,767 characters. Never silently truncate evidence.
        if (value.length > 32_767) archiveTooLarge();
        this.textBytes += Buffer.byteLength(value, 'utf8');
      }
      if (value instanceof Date && !Number.isFinite(value.getTime()))
        archiveNeedsReview();
    }
    if (
      ++this.rowCount > MAX_ARCHIVE_ROWS ||
      this.textBytes > MAX_ARCHIVE_TEXT_BYTES
    )
      archiveTooLarge();
    table.rows.push(values);
  }

  history(
    meta: {
      kind: string;
      id: string;
      version: number;
      action: string;
      at: Date;
      actor: { name: string; role: string; id: string | null };
      source: string;
      reason: string | null;
      eventId: string;
    },
    before: ArchiveFields,
    after: ArchiveFields,
  ): void {
    const comparable = (value: ArchiveValue | undefined) =>
      value instanceof Date ? value.toISOString() : (value ?? null);
    const fields = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter((key) => comparable(before[key]) !== comparable(after[key]));
    // Notes and photo-only events still get a row even if the saved fields did not change.
    if (!fields.length) fields.push('내용 변경 없음');
    for (const field of fields)
      this.add('변경 이력', [
        meta.kind,
        meta.id,
        meta.version,
        archiveLabel(meta.action),
        meta.at,
        meta.actor.name,
        archiveLabel(meta.actor.role),
        archiveLabel(meta.source),
        meta.reason,
        field,
        before[field] ?? null,
        after[field] ?? null,
        meta.eventId,
        meta.actor.id,
      ]);
  }
}
