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
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { RuntimeEnvironment } from '../config/environment';

@Injectable()
export class S3Service implements OnModuleDestroy {
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
        code: 'PHOTO_STORAGE_NOT_CONFIGURED',
        message: '사진 저장소가 준비되지 않았습니다. 관리자에게 문의해 주세요.',
      });
    }
  }

  public getBucket(): string {
    this.assertConfigured();
    return this.config.get('S3_BUCKET_NAME', { infer: true });
  }

  public async putPhoto(
    key: string,
    buffer: Buffer,
    contentType: string,
    checksumBase64: string,
  ): Promise<void> {
    const bucket = this.getBucket();
    this.assertLocation(bucket, key);
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

  public async createViewUrl(
    bucket: string,
    key: string,
    expiresIn: number,
    signingDate: Date,
  ): Promise<string> {
    this.assertLocation(bucket, key);
    if (
      !Number.isInteger(expiresIn) ||
      expiresIn < 1 ||
      expiresIn > 120 ||
      Number.isNaN(signingDate.getTime())
    ) {
      throw this.unavailable();
    }
    try {
      return await getSignedUrl(
        this.getClient(),
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: 'image/jpeg',
          ResponseContentDisposition: 'inline',
          ResponseCacheControl: 'private, no-store',
        }),
        { expiresIn, signingDate },
      );
    } catch {
      throw this.unavailable();
    }
  }

  public async deletePhoto(bucket: string, key: string): Promise<void> {
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
      !key.startsWith('photos/') ||
      key.length <= 'photos/'.length ||
      Buffer.byteLength(key, 'utf8') > 1024 ||
      [...key].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      throw this.unavailable();
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PHOTO_STORAGE_UNAVAILABLE',
      message: '사진 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
}
