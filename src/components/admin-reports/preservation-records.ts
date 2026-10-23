import type { Prisma } from '@prisma/client';
import type { ArchiveFields } from '../../libs/dto/admin-report/preservation-report';
import type { IssueRecord } from '../../libs/dto/issue-record/issue-record';
import type { SubmissionRecord } from '../../libs/dto/submission-record/submission-record';
import { archiveLabel, archiveNeedsReview } from './preservation-report-model';

export function stayFields(
  value: Prisma.JsonValue,
  expected: { id: string; propertyId: string; version: number },
): ArchiveFields {
  const row = jsonObject(value);
  const property = jsonObject(row.property);
  if (
    row.schemaVersion !== 1 ||
    row.id !== expected.id ||
    row.propertyId !== expected.propertyId ||
    property.id !== expected.propertyId ||
    row.currentRevision !== expected.version ||
    !['ACTIVE', 'CANCELLED'].includes(savedText(row.status)) ||
    !['MANUAL', 'EXCEL'].includes(savedText(row.source))
  )
    archiveNeedsReview();
  const checkIn = savedDate(row.checkInAt);
  const checkOut = savedDate(row.checkOutAt);
  const cancelled =
    row.cancelledAt === null ? null : savedDate(row.cancelledAt);
  if (
    checkOut <= checkIn ||
    (row.status === 'CANCELLED') !== (cancelled !== null)
  )
    archiveNeedsReview();
  return {
    휴양소: savedText(property.name),
    이용객: savedText(row.guestName),
    회사: nullableText(row.company),
    부서: nullableText(row.department),
    연락처: nullableText(row.phone),
    '입실 예정 (서울)': checkIn,
    '퇴실 예정 (서울)': checkOut,
    상태: archiveLabel(savedText(row.status)),
    메모: nullableText(row.notes),
    '취소 시각 (서울)': cancelled,
    '취소 사유': nullableText(row.cancellationReason),
    '등록 경로': archiveLabel(savedText(row.source)),
    지역: nullableText(property.region),
    '일정 ID': expected.id,
    '휴양소 ID': expected.propertyId,
    '이용객 ID': nullableText(row.guestUserId),
    '등록자 ID': savedText(row.createdByUserId),
    '등록 시각 (서울)': savedDate(row.createdAt),
  };
}

export function submissionFields(
  record: SubmissionRecord,
  status: string,
  photoCount: number,
): ArchiveFields {
  return {
    휴양소: record.property.name,
    구분: archiveLabel(record.type),
    방문일: record.visitDate,
    작성자: record.author.name,
    회사: record.author.company,
    부서: record.author.department,
    연락처: record.author.phone,
    '작성 경로': archiveLabel(record.authorSource),
    '작성 시작 (서울)': record.startedAt,
    '최초 제출 (서울)': record.submittedAt,
    상태: archiveLabel(status),
    '전체 메모': record.answers.generalNote,
    '응답 수': record.answers.items.length,
    '이상 응답 수': record.answers.items.filter(
      (item) => item.value === 'ABNORMAL',
    ).length,
    '사진 수': photoCount,
    '취소 시각 (서울)': record.cancelledAt,
    체크리스트: record.template.title,
    '체크리스트 버전': record.template.version,
    지역: record.property.region,
    '일정 ID': record.stayId,
    '휴양소 ID': record.property.id,
    '체크리스트 ID': record.template.id,
    '작성자 ID': record.author.id,
  };
}

export function answerFields(record: SubmissionRecord): ArchiveFields[] {
  return record.template.definition.sections.flatMap((section) =>
    section.items.map((item) => {
      const answer = record.answers.items.find((row) => row.itemId === item.id);
      return {
        휴양소: record.property.name,
        구분: archiveLabel(record.type),
        섹션: section.title,
        질문: item.label,
        응답: answer ? archiveLabel(answer.value) : '미응답',
        '이상 내용': answer?.description ?? null,
        긴급: answer?.isUrgent ? '긴급' : '일반',
        '직원 조치 기록': answer?.repairReported ? '있음' : '없음',
        '직원 조치 메모': answer?.repairNote ?? null,
        '필수 항목': item.required ? '필수' : '선택',
        '섹션 ID': section.id,
        '항목 ID': item.id,
      };
    }),
  );
}

export function answerHistory(rows: ArchiveFields[]): ArchiveFields {
  return Object.fromEntries(
    rows.flatMap((row) =>
      Object.entries(row)
        .filter(([key]) => !['휴양소', '구분'].includes(key))
        .map(([key, value]) => [
          `점검 항목 ${String(row['항목 ID'])} · ${key}`,
          value,
        ]),
    ),
  );
}

export function issueFields(record: IssueRecord): ArchiveFields {
  return {
    휴양소: record.property.name,
    제목: record.title,
    내용: record.description,
    분류: record.category.name,
    위치: record.areaLabel,
    긴급: record.isUrgent ? '긴급' : '일반',
    '처리 상태': archiveLabel(record.status),
    '기록 상태': record.cancelledAt ? '취소됨' : '유효',
    '접수 시각 (서울)': record.reportedAt,
    '해결 시각 (서울)': record.resolvedAt,
    '취소 시각 (서울)': record.cancelledAt,
    '취소 사유': record.cancellationReason,
    지역: record.property.region,
    '연결 제출 ID': record.sourceSubmissionId,
    '연결 항목 ID': record.sourceItemId,
    '이전 이상사항 ID': record.recurrenceOfIssueId,
    '이상사항 ID': record.id,
    '휴양소 ID': record.property.id,
    '분류 ID': record.category.id,
    '연결 제출 이력 ID': record.sourceRevisionId,
    '해결 담당자 ID': record.resolvedByUserId,
    '원본 체크리스트': record.source?.templateTitle ?? null,
    '원본 체크리스트 버전': record.source?.templateVersion ?? null,
  };
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return archiveNeedsReview();
  return value;
}

function savedText(value: Prisma.JsonValue | undefined): string {
  if (typeof value !== 'string') return archiveNeedsReview();
  return value;
}

function nullableText(value: Prisma.JsonValue | undefined): string | null {
  return value === null ? null : savedText(value);
}

function savedDate(value: Prisma.JsonValue | undefined): Date {
  const date = new Date(savedText(value));
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    return archiveNeedsReview();
  return date;
}
