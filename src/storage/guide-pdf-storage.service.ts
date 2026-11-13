import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import type { RuntimeEnvironment } from '../config/environment';

export const MAX_GUIDE_PDF_BYTES = 10 * 1024 * 1024;

@Injectable()
export class GuidePdfStorageService implements OnModuleDestroy {
  private client: S3Client | undefined;
  constructor(
    private readonly config: ConfigService<RuntimeEnvironment, true>,
  ) {}

  public getBucket(): string {
    const bucket = this.config.get('S3_BUCKET_NAME', { infer: true });
    if (!bucket || !this.config.get('AWS_REGION', { infer: true }))
      throw this.unavailable();
    return bucket;
  }

  public async putPdf(
    key: string,
    buffer: Buffer,
    checksum: string,
  ): Promise<void> {
    const bucket = this.getBucket();
    this.assertLocation(bucket, key);
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length < 1 ||
      buffer.length > MAX_GUIDE_PDF_BYTES
    )
      throw this.unavailable();
    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: 'application/pdf',
          ContentLength: buffer.length,
          ChecksumSHA256: checksum,
          ContentDisposition: 'attachment',
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
    } catch {
      throw this.unavailable();
    }
  }

  public async getPdf(
    bucket: string,
    key: string,
    expectedBytes: number,
  ): Promise<Buffer> {
    this.assertLocation(bucket, key);
    if (
      !Number.isInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > MAX_GUIDE_PDF_BYTES
    )
      throw this.unavailable();
    let stream: Readable | undefined;
    let readDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const object = await this.getClient().send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
      if (!(object.Body instanceof Readable)) throw this.unavailable();
      stream = object.Body;
      readDeadline = setTimeout(() => {
        stream?.destroy(new Error('Guide file read timed out'));
      }, 30_000);
      if (
        object.ContentLength !== expectedBytes ||
        object.ContentType !== 'application/pdf'
      )
        throw this.unavailable();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array)) throw this.unavailable();
        size += chunk.byteLength;
        if (size > expectedBytes) throw this.unavailable();
        chunks.push(Buffer.from(chunk));
      }
      if (size !== expectedBytes) throw this.unavailable();
      return Buffer.concat(chunks, size);
    } catch {
      throw this.unavailable();
    } finally {
      clearTimeout(readDeadline);
      stream?.destroy();
    }
  }

  public async deletePdf(bucket: string, key: string): Promise<void> {
    this.assertLocation(bucket, key);
    try {
      await this.getClient().send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(30_000) },
      );
    } catch {
      throw this.unavailable();
    }
  }

  public onModuleDestroy(): void {
    this.client?.destroy();
  }
  private getClient(): S3Client {
    this.getBucket();
    this.client ??= new S3Client({
      region: this.config.get('AWS_REGION', { infer: true }),
      maxAttempts: 2,
    });
    return this.client;
  }
  private assertLocation(bucket: string, key: string): void {
    if (
      bucket !== this.getBucket() ||
      !/^guides\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(key)
    )
      throw this.unavailable();
  }
  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'GUIDE_PDF_STORAGE_UNAVAILABLE',
      message:
        '이용 안내 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}
