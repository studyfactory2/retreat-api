import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  MAX_WORKBOOK_BYTES,
  MAX_WORKBOOK_ROWS,
  MAX_WORKBOOK_SHEET_ROWS,
  MAX_WORKBOOK_SHEETS,
  ROSTER_WORKBOOK_COLUMNS,
  type WorkbookGrid,
  type WorkbookReadResult,
} from './roster-workbook';

const CFB_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
const WORKBOOK_TIMEOUT_MS = 5000;
const MAX_ACTIVE_PARSERS = 2;

@Injectable()
export class RosterWorkbookReaderService {
  private static activeParsers = 0;

  public async read(buffer: Buffer): Promise<WorkbookGrid> {
    if (!Buffer.isBuffer(buffer)) throw this.invalid();
    if (buffer.length > MAX_WORKBOOK_BYTES) throw this.tooLarge();
    if (
      buffer.length < CFB_SIGNATURE.length ||
      !buffer.subarray(0, CFB_SIGNATURE.length).equals(CFB_SIGNATURE)
    ) {
      throw this.invalid();
    }
    if (RosterWorkbookReaderService.activeParsers >= MAX_ACTIVE_PARSERS) {
      throw new HttpException(
        {
          code: 'WORKBOOK_PARSING_BUSY',
          message: '다른 명단을 확인 중입니다. 잠시 후 다시 시도해 주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    RosterWorkbookReaderService.activeParsers += 1;
    let worker: Worker | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      worker = new Worker(join(__dirname, 'roster-workbook.worker.js'), {
        workerData: buffer,
        resourceLimits: { maxOldGenerationSizeMb: 256 },
        execArgv: [],
      });
      const activeWorker = worker;
      return await new Promise<WorkbookGrid>((resolve, reject) => {
        timer = setTimeout(() => reject(this.tooLarge()), WORKBOOK_TIMEOUT_MS);
        activeWorker.once('message', (result: unknown) => {
          if (!this.isResult(result)) {
            reject(this.unavailable());
          } else if (result.ok === false) {
            reject(
              result.code === 'WORKBOOK_LIMIT_EXCEEDED'
                ? this.tooLarge()
                : this.invalid(),
            );
          } else {
            resolve(result.workbook);
          }
        });
        activeWorker.once('error', (error: Error & { code?: string }) => {
          reject(
            error.code === 'ERR_WORKER_OUT_OF_MEMORY'
              ? this.tooLarge()
              : this.unavailable(),
          );
        });
        activeWorker.once('exit', () => reject(this.unavailable()));
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw this.unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      try {
        await worker?.terminate();
      } catch {
        // Parsing failures already have safe public errors; shutdown adds none.
      }
      RosterWorkbookReaderService.activeParsers -= 1;
    }
  }

  private isResult(value: unknown): value is WorkbookReadResult {
    if (typeof value !== 'object' || value === null) return false;
    const result = value as Partial<WorkbookReadResult>;
    if (result.ok === false) {
      return (
        result.code === 'INVALID_WORKBOOK' ||
        result.code === 'WORKBOOK_LIMIT_EXCEEDED'
      );
    }
    if (result.ok !== true) return false;
    const workbook = result.workbook;
    if (
      !workbook ||
      typeof workbook.date1904 !== 'boolean' ||
      !Array.isArray(workbook.sheets) ||
      workbook.sheets.length < 1 ||
      workbook.sheets.length > MAX_WORKBOOK_SHEETS
    ) {
      return false;
    }
    let totalRows = 0;
    return workbook.sheets.every((sheet) => {
      if (
        !sheet ||
        typeof sheet.name !== 'string' ||
        typeof sheet.hidden !== 'boolean' ||
        !Array.isArray(sheet.rows) ||
        sheet.rows.length > MAX_WORKBOOK_SHEET_ROWS
      ) {
        return false;
      }
      totalRows += sheet.rows.length;
      if (totalRows > MAX_WORKBOOK_ROWS) return false;
      let previousRow = 0;
      return sheet.rows.every((row) => {
        if (
          !row ||
          !Number.isInteger(row.rowNumber) ||
          row.rowNumber <= previousRow ||
          row.rowNumber > MAX_WORKBOOK_SHEET_ROWS ||
          !Array.isArray(row.cells) ||
          row.cells.length !== ROSTER_WORKBOOK_COLUMNS
        ) {
          return false;
        }
        previousRow = row.rowNumber;
        return row.cells.every(
          (cell) =>
            cell &&
            typeof cell.type === 'string' &&
            (cell.format === null || typeof cell.format === 'string') &&
            typeof cell.formula === 'boolean' &&
            (cell.value === null ||
              typeof cell.value === 'string' ||
              typeof cell.value === 'boolean' ||
              (typeof cell.value === 'number' && Number.isFinite(cell.value))),
        );
      });
    });
  }

  private invalid(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_WORKBOOK',
      message: '명단 파일을 읽을 수 없습니다. 올바른 XLS 파일을 선택해 주세요.',
    });
  }

  private tooLarge(): PayloadTooLargeException {
    return new PayloadTooLargeException({
      code: 'WORKBOOK_LIMIT_EXCEEDED',
      message: '명단 파일의 크기나 내용이 처리 한도를 초과했습니다.',
    });
  }

  private unavailable(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'WORKBOOK_READER_UNAVAILABLE',
      message: '명단 파일을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}
