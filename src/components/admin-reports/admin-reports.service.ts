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
import { PreservationReportReaderService } from './preservation-report-reader.service';
import {
  PreservationZipService,
  type PreservationZipDownload,
} from './preservation-zip.service';
import { PreservationReportWorkbookService } from './preservation-report-workbook.service';

@Injectable()
export class AdminReportsService {
  private generating = false;

  constructor(
    private readonly reader: AdminReportReaderService,
    private readonly workbook: AdminReportWorkbookService,
    private readonly preservationReader: PreservationReportReaderService,
    private readonly preservationWorkbook: PreservationReportWorkbookService,
    private readonly preservationZip: PreservationZipService,
  ) {}

  public async getExcel(input: GetAdminReportInput): Promise<StreamableFile> {
    return this.generate(input, false);
  }

  public async getPreservationExcel(
    input: GetAdminReportInput,
  ): Promise<StreamableFile> {
    return this.generate(input, true);
  }

  public async getPreservationZip(
    input: GetAdminReportInput,
    signal: AbortSignal,
  ): Promise<PreservationZipDownload> {
    this.acquire();
    try {
      return await this.preservationZip.create(input, signal, () => {
        this.generating = false;
      });
    } catch (error) {
      this.generating = false;
      throw error;
    }
  }

  private acquire(): void {
    if (this.generating)
      throw new HttpException(
        {
          code: 'REPORT_EXPORT_BUSY',
          message: '보고서를 생성 중입니다. 잠시 후 다시 시도해 주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.generating = true;
  }

  private async generate(
    input: GetAdminReportInput,
    preservation: boolean,
  ): Promise<StreamableFile> {
    this.acquire();
    try {
      const buffer = preservation
        ? this.preservationWorkbook.create(
            await this.preservationReader.read(input),
          )
        : this.workbook.create(await this.reader.read(input));
      const filename = `retreat-${preservation ? 'archive' : 'report'}-${input.from}-${input.to}.xlsx`;
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
