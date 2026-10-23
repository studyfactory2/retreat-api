import { HttpException, Injectable, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import type { GetAdminReportInput } from '../../libs/dto/admin-report/admin-report.input';
import type { PreservationReport } from '../../libs/dto/admin-report/preservation-report';
import { S3Service } from '../../storage/s3.service';
import { archiveNeedsReview } from './preservation-report-model';
import { PreservationReportReaderService } from './preservation-report-reader.service';
import { PreservationReportWorkbookService } from './preservation-report-workbook.service';
import {
  ARCHIVE_PREPARATION_MS,
  ARCHIVE_TRANSFER_MS,
  MAX_ARCHIVE_PHOTOS,
  MAX_ARCHIVE_PHOTO_BYTES,
  MAX_ARCHIVE_ZIP_BYTES,
  archivePhotosTooLarge,
  archivePhotoUnavailable,
  archiveTimedOut,
  type ArchivePhotoCounts,
  type PreservationArchivePhoto,
} from './preservation-zip-policy';

interface PhotoResult {
  photo: PreservationArchivePhoto;
  path: string | null;
  localPath?: string;
  result: string;
}

export interface PreservationZipDownload {
  file: StreamableFile;
  counts: ArchivePhotoCounts;
  dispose: () => Promise<void>;
}

@Injectable()
export class PreservationZipService {
  constructor(
    private readonly reader: PreservationReportReaderService,
    private readonly workbook: PreservationReportWorkbookService,
    private readonly storage: S3Service,
  ) {}

  public async create(
    input: GetAdminReportInput,
    requestSignal: AbortSignal,
    onDisposed: () => void = () => undefined,
  ): Promise<PreservationZipDownload> {
    const deadline = Date.now() + ARCHIVE_PREPARATION_MS;
    const timeout = AbortSignal.timeout(ARCHIVE_PREPARATION_MS);
    const signal = AbortSignal.any([requestSignal, timeout]);
    const assertPreparing = (): void => {
      requestSignal.throwIfAborted();
      if (Date.now() >= deadline) archiveTimedOut();
      signal.throwIfAborted();
    };
    let directory: string | undefined;
    try {
      assertPreparing();
      const photos = new Map<string, PreservationArchivePhoto>();
      const data = await this.reader.read(input, photos);
      assertPreparing();
      this.validatePlan(photos);
      directory = await mkdtemp(join(tmpdir(), 'retreat-photo-archive-'));
      const results: PhotoResult[] = [];
      let actualBytes = 0;
      for (const photo of photos.values()) {
        assertPreparing();
        const skip =
          photo.deleted || photo.status === 'DELETED'
            ? '제외 · 삭제됨'
            : photo.status !== 'READY'
              ? '제외 · 사용 불가'
              : null;
        if (skip) {
          results.push({ photo, path: null, result: skip });
          continue;
        }
        const source = await this.storage.getPhoto(
          photo.storageBucket,
          photo.storageKey,
          signal,
        );
        if (!source) {
          results.push({ photo, path: null, result: '제외 · 저장 파일 없음' });
          continue;
        }
        const localPath = join(directory, `${photo.id}.jpg`);
        const path = `사진/${safePropertyName(photo.propertyName)}_${photo.propertyId}/${photo.id}.jpg`;
        const digest = createHash('sha256');
        let fileBytes = 0;
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            fileBytes += chunk.length;
            actualBytes += chunk.length;
            if (actualBytes > MAX_ARCHIVE_PHOTO_BYTES) {
              try {
                archivePhotosTooLarge();
              } catch (error) {
                callback(error as Error);
                return;
              }
            }
            if (fileBytes > photo.sizeBytes) {
              try {
                archivePhotoUnavailable();
              } catch (error) {
                callback(error as Error);
                return;
              }
            }
            digest.update(chunk);
            callback(null, chunk);
          },
        });
        try {
          if (
            source.contentLength !== undefined &&
            source.contentLength !== photo.sizeBytes
          )
            archivePhotoUnavailable();
          await pipeline(
            source.body,
            meter,
            createWriteStream(localPath, { flags: 'wx', mode: 0o600 }),
            { signal },
          );
          if (
            fileBytes !== photo.sizeBytes ||
            (photo.checksumSha256 &&
              digest.digest('hex') !== photo.checksumSha256.toLowerCase())
          )
            archivePhotoUnavailable();
        } catch (error) {
          assertPreparing();
          if (error instanceof HttpException) throw error;
          archivePhotoUnavailable();
        } finally {
          source.body.destroy();
        }
        results.push({ photo, path, localPath, result: '포함' });
      }
      assertPreparing();
      const counts = {
        total: results.length,
        included: results.filter((result) => result.path !== null).length,
        skipped: results.filter((result) => result.path === null).length,
      };
      const archiveData = this.withResults(data, results, counts);
      const workbook = this.workbook.create(archiveData);
      assertPreparing();
      const zipPath = join(directory, 'archive.zip');
      await this.writeZip(zipPath, workbook, archiveData, results, signal);
      assertPreparing();
      const length = (await stat(zipPath)).size;
      assertPreparing();
      if (length > MAX_ARCHIVE_ZIP_BYTES) archivePhotosTooLarge();
      const stream = createReadStream(zipPath);
      const ownedDirectory = directory;
      let cleanup: Promise<void> | undefined;
      const dispose = (): Promise<void> => {
        if (cleanup === undefined) {
          clearTimeout(transferTimeout);
          requestSignal.removeEventListener('abort', onAbort);
          stream.destroy();
          cleanup = rm(ownedDirectory, {
            recursive: true,
            force: true,
          }).finally(onDisposed);
        }
        return cleanup;
      };
      stream.once('error', () => {
        void dispose().catch(() => undefined);
      });
      const onAbort = (): void => {
        void dispose().catch(() => undefined);
      };
      const transferTimeout = setTimeout(() => {
        stream.destroy(new Error('Archive transfer expired'));
        void dispose().catch(() => undefined);
      }, ARCHIVE_TRANSFER_MS);
      transferTimeout.unref();
      requestSignal.addEventListener('abort', onAbort, { once: true });
      if (requestSignal.aborted) {
        await dispose();
        requestSignal.throwIfAborted();
      }
      // The controller owns disposal after HTTP finish/close, including a slow or aborted consumer.
      return {
        file: new StreamableFile(stream, {
          type: 'application/zip',
          disposition: `attachment; filename="retreat-archive-${input.from}-${input.to}.zip"`,
          length,
        }),
        counts,
        dispose,
      };
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true });
      if (timeout.aborted && !requestSignal.aborted) archiveTimedOut();
      throw error;
    }
  }

  private validatePlan(photos: Map<string, PreservationArchivePhoto>): void {
    if (photos.size > MAX_ARCHIVE_PHOTOS) archivePhotosTooLarge();
    let expectedBytes = 0;
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const photo of photos.values()) {
      if (!uuid.test(photo.id) || !uuid.test(photo.propertyId))
        archiveNeedsReview();
      if (photo.deleted || photo.status !== 'READY') continue;
      if (
        photo.contentType !== 'image/jpeg' ||
        !Number.isSafeInteger(photo.sizeBytes) ||
        photo.sizeBytes < 1 ||
        (photo.checksumSha256 !== null &&
          !/^[a-f0-9]{64}$/i.test(photo.checksumSha256))
      )
        archiveNeedsReview();
      expectedBytes += photo.sizeBytes;
      if (expectedBytes > MAX_ARCHIVE_PHOTO_BYTES) archivePhotosTooLarge();
    }
  }

  private withResults(
    data: PreservationReport,
    results: PhotoResult[],
    counts: ArchivePhotoCounts,
  ): PreservationReport {
    const byId = new Map(results.map((result) => [result.photo.id, result]));
    return {
      ...data,
      photoPackage: counts,
      tables: data.tables.map((table) => {
        if (table.name !== '사진 목록') return table;
        const idIndex = table.headers.indexOf('사진 ID');
        if (idIndex < 0) archiveNeedsReview();
        return {
          ...table,
          headers: [...table.headers, 'ZIP 파일 경로', '다운로드 결과'],
          rows: table.rows.map((row) => {
            const result = byId.get(String(row[idIndex]));
            if (!result) archiveNeedsReview();
            return [...row, result.path, result.result];
          }),
        };
      }),
    };
  }

  private async writeZip(
    path: string,
    workbook: Buffer,
    data: PreservationReport,
    results: PhotoResult[],
    signal: AbortSignal,
  ): Promise<void> {
    const zip = new ZipFile();
    const zipOutput = zip.outputStream as Readable;
    const inputs = new Set<Readable>();
    zip.on('error', (error: Error) => zipOutput.destroy(error));
    const destroyInputs = (): void => {
      for (const input of inputs) input.destroy();
    };
    signal.addEventListener('abort', destroyInputs, { once: true });
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_ARCHIVE_ZIP_BYTES) {
          try {
            archivePhotosTooLarge();
          } catch (error) {
            callback(error as Error);
            return;
          }
        }
        callback(null, chunk);
      },
    });
    const output = pipeline(
      zipOutput,
      meter,
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
      { signal },
    );
    try {
      zip.addBuffer(workbook, '기록.xlsx', {
        compress: false,
        mtime: data.generatedAt,
      });
      zip.addBuffer(
        Buffer.from(this.readme(data, results), 'utf8'),
        '다운로드안내.txt',
        {
          mtime: data.generatedAt,
        },
      );
      for (const result of results)
        if (result.path && result.localPath) {
          const localPath = result.localPath;
          zip.addReadStreamLazy(
            result.path,
            {
              compress: false,
              mtime: data.generatedAt,
              size: result.photo.sizeBytes,
            },
            (callback) => {
              if (signal.aborted || zipOutput.destroyed) {
                callback(
                  new Error('Archive preparation interrupted'),
                  undefined,
                );
                return;
              }
              const input = createReadStream(localPath);
              inputs.add(input);
              input.once('close', () => inputs.delete(input));
              callback(null, input);
            },
          );
        }
      zip.end();
      await output;
    } catch (error) {
      zipOutput.destroy(
        error instanceof Error ? error : new Error('Archive ZIP failed'),
      );
      await output.catch(() => undefined);
      throw error;
    } finally {
      signal.removeEventListener('abort', destroyInputs);
      destroyInputs();
      zipOutput.destroy();
    }
  }

  private readme(data: PreservationReport, results: PhotoResult[]): string {
    const counts = data.photoPackage;
    return [
      '휴양소 기록 · 엑셀 + 사진 보관',
      `휴양소: ${plainLine(data.propertyLabel)}`,
      `선택 기간 (서울): ${data.from} ~ ${data.to}`,
      `조회 시각 (서울, UTC+09:00): ${new Date(data.generatedAt.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')}`,
      '',
      `전체 사진 ${counts.total}장 · 포함 ${counts.included}장 · 제외 ${counts.skipped}장`,
      '사진 수는 사진 ID 기준입니다. 같은 사진의 여러 버전/이벤트 연결은 엑셀 사진 목록에 남습니다.',
      '기록.xlsx: 안내, 이용 일정, 점검 기록, 점검 답변, 이상사항, 변경 이력, 사진 목록 (7개 시트)',
      '사진/: 선택 기록의 전체 이력에 연결된 앱 저장 JPEG. 촬영 원본이 아니며 앱에서 크기와 형식을 처리한 파일입니다.',
      '선택 기간은 기록 기준입니다. 사진 등록일이나 변경일이 기간 밖이어도 해당 기록 이력의 사진은 포함합니다.',
      '취소된 기록과 보관된 휴양소도 포함합니다. 사용 중인 비밀번호, QR/개인 링크, 차량번호는 포함하지 않습니다.',
      '자동 백업이나 앱 복원 파일이 아닙니다. 내려받은 ZIP은 직접 안전하게 보관해 주세요.',
      '엑셀 사진 목록의 ZIP 파일 경로 및 다운로드 결과로 파일과 기록을 연결하세요.',
      '',
      '사진별 다운로드 결과',
      ...(results.length
        ? results.map(
            ({ photo, path, result }) =>
              `${photo.id}\t${result}\t${path ?? '-'}\t${plainLine(photo.originalFilename)}`,
          )
        : ['연결된 사진이 없습니다. 엑셀과 안내만 포함했습니다.']),
      '',
      '삭제됨: 데이터베이스에 삭제 표시가 있어 파일을 요청하지 않았습니다.',
      '사용 불가: 업로드가 완료된 사용 가능 상태가 아니므로 제외했습니다.',
      '저장 파일 없음: 저장소가 해당 파일이 없다고 확인했습니다.',
      '권한, 연결, 시간 초과 또는 파일 무결성 오류가 발생하면 ZIP 전체가 실패하며 성공으로 표시하지 않습니다.',
      '',
    ].join('\r\n');
  }
}

function safePropertyName(value: string): string {
  const name = [
    ...value
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N} _-]/gu, '_')
      .trim(),
  ]
    .slice(0, 40)
    .join('');
  return name || '휴양소';
}

function plainLine(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');
}
