import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { IssueStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import type {
  ReportData,
  ReportIssueRow,
  ReportSubmissionRow,
} from '../../libs/dto/admin-report/admin-report';
import { MAX_REPORT_BYTES } from './admin-report-policy';

type ReportCell = XLSX.CellObject | undefined;
type ReportRow = ReportCell[];

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_LEAP_BUG_MS = Date.UTC(1900, 2, 1);
const TABLE_ROW = 9;

const issueStatuses: Record<IssueStatus, string> = {
  NEW: '신규 접수',
  IN_PROGRESS: '조치 중',
  RESOLVED: '조치 완료',
};

@Injectable()
export class AdminReportWorkbookService {
  public create(data: ReportData): Buffer {
    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: '휴양소 운영 보고서',
      Subject: `${data.from} ~ ${data.to}`,
      CreatedDate: data.generatedAt,
    };

    XLSX.utils.book_append_sheet(
      workbook,
      this.sheet(
        data,
        '입퇴실 제출',
        '제출일 기준입니다. 제출 완료된 입실·퇴실 체크리스트를 표시하며, 취소된 제출은 제외합니다.',
        [
          '이용일',
          '휴양소',
          '구분',
          '작성자',
          '제출 시각 (서울)',
          '확인 항목 수',
          '이상 항목 수',
          '사진 수',
          '지역',
          '이용 내역 ID',
          '제출 ID',
          '개정',
        ],
        [16, 30, 14, 22, 26, 16, 16, 12, 20, 38, 38, 10],
        data.guestSubmissions.map((row) => this.guestRow(row)),
      ),
      '입퇴실 제출',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      this.sheet(
        data,
        '정비 제출',
        '제출일 기준입니다. 제출 완료된 정비 체크리스트를 표시하며, 취소된 제출은 제외합니다.',
        [
          '정비일',
          '휴양소',
          '정비 담당자',
          '정비 시작 (서울)',
          '정비 완료 (서울)',
          '확인 항목 수',
          '이상 항목 수',
          '사진 수',
          '지역',
          '제출 ID',
          '개정',
        ],
        [16, 30, 22, 26, 26, 16, 16, 12, 20, 38, 10],
        data.maintenanceSubmissions.map((row) => this.maintenanceRow(row)),
      ),
      '정비 제출',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      this.sheet(
        data,
        '이상사항',
        '접수일 기준입니다. 상태는 출력 시점의 현재 상태이며, 취소된 이상사항은 제외합니다.',
        [
          '접수 시각 (서울)',
          '휴양소',
          '이상사항 제목',
          '상태',
          '긴급',
          '분류',
          '구역',
          '조치 완료 (서울)',
          '지역',
          '이상사항 ID',
          '버전',
        ],
        [26, 30, 54, 16, 10, 20, 26, 26, 20, 38, 10],
        data.issues.map((row) => this.issueRow(row)),
      ),
      '이상사항',
    );

    const output: unknown = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
      bookSST: false,
    });
    if (!Buffer.isBuffer(output) || output.length > MAX_REPORT_BYTES) {
      throw new PayloadTooLargeException({
        code: 'REPORT_TOO_LARGE',
        message:
          '보고서가 너무 큽니다. 조회 기간이나 휴양소 범위를 줄여 주세요.',
      });
    }
    return output;
  }

  private sheet(
    data: ReportData,
    title: string,
    dateBasis: string,
    headers: string[],
    widths: number[],
    records: ReportRow[],
  ): XLSX.WorkSheet {
    const total =
      data.guestSubmissions.length +
      data.maintenanceSubmissions.length +
      data.issues.length;
    const rows: ReportRow[] = [
      [],
      [this.text(`휴양소 운영 보고서: ${title}`)],
      [this.text('조회 기간'), this.text(`${data.from} ~ ${data.to}`)],
      [this.text('휴양소'), this.text(data.propertyLabel)],
      [this.text('출력 시각'), this.timestamp(data.generatedAt)],
      [
        this.text('시트 건수'),
        this.number(records.length),
        this.text('전체 건수'),
        this.number(total),
      ],
      [this.text(dateBasis)],
      [
        this.text(
          '모든 시각은 한국 시간(UTC+09:00) 기준입니다. 항목별 답변, 사진과 수정 이력은 관리자 화면에서 확인할 수 있습니다.',
        ),
      ],
      [],
      headers.map((header) => this.text(header)),
      ...records,
    ];
    if (records.length === 0) rows.push([this.text('조회된 기록이 없습니다.')]);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = widths.map((wch) => ({ wch }));
    sheet['!rows'] = rows.map((_row, index) => ({
      hpt: index === 1 || index === TABLE_ROW ? 25 : 21,
    }));
    if (records.length > 0) {
      sheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: TABLE_ROW, c: 0 },
          e: { r: TABLE_ROW + records.length, c: headers.length - 1 },
        }),
      };
    }
    sheet['!margins'] = {
      left: 0.3,
      right: 0.3,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2,
    };
    return sheet;
  }

  private guestRow(row: ReportSubmissionRow): ReportRow {
    return [
      this.date(row.visitDate),
      this.text(row.propertyName),
      this.text(row.type === 'CHECK_IN' ? '입실' : '퇴실'),
      this.text(row.authorName),
      this.timestamp(row.submittedAt),
      this.number(row.answeredItemCount),
      this.number(row.abnormalItemCount),
      this.number(row.photoCount),
      this.text(row.region),
      this.text(row.stayId),
      this.text(row.id),
      this.number(row.revision),
    ];
  }

  private maintenanceRow(row: ReportSubmissionRow): ReportRow {
    return [
      this.date(row.visitDate),
      this.text(row.propertyName),
      this.text(row.authorName),
      this.timestamp(row.startedAt),
      this.timestamp(row.submittedAt),
      this.number(row.answeredItemCount),
      this.number(row.abnormalItemCount),
      this.number(row.photoCount),
      this.text(row.region),
      this.text(row.id),
      this.number(row.revision),
    ];
  }

  private issueRow(row: ReportIssueRow): ReportRow {
    return [
      this.timestamp(row.reportedAt),
      this.text(row.propertyName),
      this.text(row.title),
      this.text(issueStatuses[row.status]),
      this.text(row.isUrgent ? '긴급' : '일반'),
      this.text(row.categoryName),
      this.text(row.areaLabel),
      this.timestamp(row.resolvedAt),
      this.text(row.region),
      this.text(row.id),
      this.number(row.version),
    ];
  }

  private text(value: string | null): ReportCell {
    // Explicit string cells keep every user value literal, including formula-like text.
    return value === null ? undefined : { t: 's', v: value };
  }

  private number(value: number): XLSX.CellObject {
    return { t: 'n', v: value, z: '#,##0' };
  }

  private date(value: string): XLSX.CellObject {
    return this.excelDate(Date.parse(`${value}T00:00:00.000Z`), 'yyyy-mm-dd');
  }

  private timestamp(value: Date | null): ReportCell {
    if (value === null) return undefined;
    return this.excelDate(
      value.getTime() + SEOUL_OFFSET_MS,
      'yyyy-mm-dd hh:mm:ss',
    );
  }

  private excelDate(milliseconds: number, format: string): XLSX.CellObject {
    // Excel inserts a fictional 1900-02-29; dates before it need one less day.
    const serial =
      (milliseconds - EXCEL_EPOCH_MS) / DAY_MS -
      (milliseconds < EXCEL_LEAP_BUG_MS ? 1 : 0);
    return { t: 'n', v: serial, z: format };
  }
}
