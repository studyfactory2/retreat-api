import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type {
  ArchiveValue,
  PreservationReport,
} from '../../libs/dto/admin-report/preservation-report';
import { MAX_REPORT_BYTES } from './admin-report-policy';
import { archiveTooLarge } from './preservation-report-model';
import {
  archiveGuideLayout,
  archiveTableLayout,
  type ArchiveSheetLayout,
} from './preservation-workbook-layout';
import { stylePreservationWorkbook } from './preservation-workbook-style';

@Injectable()
export class PreservationReportWorkbookService {
  create(data: PreservationReport): Buffer {
    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: '휴양소 기록 보관',
      Subject: `${data.from} ~ ${data.to}`,
      CreatedDate: data.generatedAt,
    };
    const layouts = [
      archiveGuideLayout(data),
      ...data.tables.map((table) => archiveTableLayout(data, table)),
    ];
    for (const layout of layouts)
      XLSX.utils.book_append_sheet(workbook, this.sheet(layout), layout.name);
    const raw: unknown = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true,
      bookSST: false,
    });
    if (!Buffer.isBuffer(raw) || raw.length > MAX_REPORT_BYTES)
      return archiveTooLarge();
    const output = stylePreservationWorkbook(raw, layouts);
    if (output.length > MAX_REPORT_BYTES) return archiveTooLarge();
    return output;
  }

  private sheet(layout: ArchiveSheetLayout): XLSX.WorkSheet {
    const sheet = XLSX.utils.aoa_to_sheet(
      layout.rows.map((row) => row.map((value) => this.cell(value))),
    );
    sheet['!cols'] = layout.widths.map((wch) => ({ wch }));
    sheet['!rows'] = layout.heights.map((hpt) => ({ hpt }));
    sheet['!merges'] = layout.merges.map((range) =>
      XLSX.utils.decode_range(range),
    );
    sheet['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: layout.rows.length - 1, c: layout.widths.length - 1 },
    });
    if (layout.headers) {
      sheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 4, c: 0 },
          e: { r: layout.rows.length - 1, c: layout.headers.length - 1 },
        }),
      };
    }
    return sheet;
  }

  private cell(value: ArchiveValue): XLSX.CellObject | undefined {
    if (value === null) return undefined;
    if (value instanceof Date) {
      const local = value.getTime() + 9 * 60 * 60 * 1000;
      return {
        t: 'n',
        v:
          (local - Date.UTC(1899, 11, 30)) / 86_400_000 -
          (local < Date.UTC(1900, 2, 1) ? 1 : 0),
        z: 'yyyy-mm-dd hh:mm:ss',
      };
    }
    // Explicit text cells and format preserve leading zeroes in spreadsheet viewers.
    // User-supplied text never becomes a formula or external link.
    return typeof value === 'number'
      ? { t: 'n', v: value, z: '#,##0' }
      : { t: 's', v: value, z: '@' };
  }
}
