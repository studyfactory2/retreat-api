import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { RuntimeEnvironment } from '../config/environment';

@Injectable()
export class ImportSourceStorageService implements OnModuleDestroy {
  private client: S3Client | undefined;

  constructor(
    private readonly config: ConfigService<RuntimeEnvironment, true>,
  ) {}

  public assertConfigured(): void {
    if (
      !this.config.get('AWS_REGION', { infer: true }) ||
      !this.config.get('S3_BUCKET_NAME', { infer: true })
    ) {
      throw new ServiceUnavailableException({
        code: 'IMPORT_STORAGE_NOT_CONFIGURED',
        message: '명단 저장소가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      });
    }
  }

  public getBucket(): string {
    this.assertConfigured();
    return this.config.get('S3_BUCKET_NAME', { infer: true });
  }

  public async putSource(
    key: string,
    buffer: Buffer,
    contentType: string,
    checksumBase64: string,
  ): Promise<void> {
    const bucket = this.getBucket();
    this.assertLocation(bucket, key);
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length < 1 ||
      contentType !== 'application/vnd.ms-excel' ||
      typeof checksumBase64 !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(checksumBase64) ||
      Buffer.from(checksumBase64, 'base64').toString('base64') !==
        checksumBase64
    ) {
      throw this.unavailable();
    }
    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ContentLength: buffer.length,
          ChecksumSHA256: checksumBase64,
          CacheControl: 'private, no-store',
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
    } catch {
      throw this.unavailable();
    }
  }

  public async deleteSource(bucket: string, key: string): Promise<void> {
    this.assertLocation(bucket, key);
    try {
      await this.getClient().send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) },
      );
    } catch {
      throw this.unavailable();
    }
  }

  public onModuleDestroy(): void {
    this.client?.destroy();
  }

  private getClient(): S3Client {
    this.assertConfigured();
    this.client ??= new S3Client({
      region: this.config.get('AWS_REGION', { infer: true }),
      maxAttempts: 2,
    });
    return this.client;
  }

  private assertLocation(bucket: string, key: string): void {
    if (
      bucket !== this.getBucket() ||
      typeof key !== 'string' ||
      !/^imports\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xls$/.test(
        key,
      )
    ) {
      throw this.unavailable();
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'IMPORT_STORAGE_UNAVAILABLE',
      message: '명단 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}
