import {
  HttpException,
  HttpStatus,
  Injectable,
  StreamableFile,
} from '@nestjs/common';
import type { GetAdminReportInput } from '../../libs/dto/admin-report/admin-report.input';
import { AdminReportReaderService } from './admin-report-reader.service';
import { AdminReportWorkbookService } from './admin-report-workbook.service';
import { REPORT_CONTENT_TYPE } from './admin-report-policy';

@Injectable()
export class AdminReportsService {
  private generating = false;

  constructor(
    private readonly reader: AdminReportReaderService,
    private readonly workbook: AdminReportWorkbookService,
  ) {}

  public async getExcel(input: GetAdminReportInput): Promise<StreamableFile> {
    if (this.generating)
      throw new HttpException(
        {
          code: 'REPORT_EXPORT_BUSY',
          message: '보고서를 생성 중입니다. 잠시 후 다시 시도해 주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );

    this.generating = true;
    try {
      const data = await this.reader.read(input);
      const buffer = this.workbook.create(data);
      const filename = `retreat-report-${data.from}-${data.to}.xlsx`;
      return new StreamableFile(buffer, {
        type: REPORT_CONTENT_TYPE,
        disposition: `attachment; filename="${filename}"`,
        length: buffer.length,
      });
    } finally {
      this.generating = false;
    }
  }
}
