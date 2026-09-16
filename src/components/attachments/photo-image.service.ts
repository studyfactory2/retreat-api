import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type {} from 'multer';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS } from './photo-policy';

export interface PreparedPhoto {
  buffer: Buffer;
  contentType: 'image/jpeg';
  filename: string;
  width: number;
  height: number;
  checksumSha256: string;
  checksumBase64: string;
}

type PhotoFormat = 'jpeg' | 'png' | 'webp';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

@Injectable()
export class PhotoImageService {
  private activeJobs = 0;

  public async prepare(file: Express.Multer.File): Promise<PreparedPhoto> {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw this.invalidPhoto();
    }
    if (file.buffer.length > MAX_PHOTO_BYTES) throw this.tooLarge();
    const format = this.detectFormat(file.buffer);
    if (!format) throw this.unsupported();
    if (this.activeJobs >= 2) {
      throw new HttpException(
        {
          code: 'PHOTO_PROCESSING_BUSY',
          message: '다른 사진을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeJobs += 1;
    let image: sharp.Sharp | undefined;
    try {
      image = sharp(file.buffer, {
        failOn: 'warning',
        limitInputPixels: MAX_PHOTO_PIXELS,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== format ||
        (metadata.pages ?? 1) !== 1 ||
        this.isAnimatedPng(file.buffer, format)
      ) {
        throw this.unsupported();
      }
      if (!metadata.width || !metadata.height) throw this.invalidPhoto();
      if (metadata.width * metadata.height > MAX_PHOTO_PIXELS) {
        throw this.tooLarge();
      }

      // Re-encoding drops EXIF/GPS and other original metadata by default.
      const { data, info } = await image
        .rotate()
        .resize({
          width: 2560,
          height: 2560,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .timeout({ seconds: 20 })
        .toBuffer({ resolveWithObject: true });
      if (data.length > MAX_PHOTO_BYTES) throw this.tooLarge();
      const checksum = createHash('sha256').update(data).digest();
      return {
        buffer: data,
        contentType: 'image/jpeg',
        filename: this.safeFilename(file.originalname),
        width: info.width,
        height: info.height,
        checksumSha256: checksum.toString('hex'),
        checksumBase64: checksum.toString('base64'),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && /pixel limit/i.test(error.message)) {
        throw this.tooLarge();
      }
      throw this.invalidPhoto();
    } finally {
      image?.destroy();
      this.activeJobs -= 1;
    }
  }

  private detectFormat(buffer: Buffer): PhotoFormat | undefined {
    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'jpeg';
    }
    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
    if (
      buffer.length >= 12 &&
      buffer.toString('latin1', 0, 4) === 'RIFF' &&
      buffer.toString('latin1', 8, 12) === 'WEBP'
    ) {
      return 'webp';
    }
    return undefined;
  }

  private isAnimatedPng(buffer: Buffer, format: PhotoFormat): boolean {
    if (format !== 'png') return false;
    // Sharp's frame metadata does not identify APNG, so inspect PNG chunks.
    for (let offset = 8; offset + 12 <= buffer.length;) {
      const length = buffer.readUInt32BE(offset);
      const next = offset + length + 12;
      if (next > buffer.length) throw this.invalidPhoto();
      const type = buffer.toString('latin1', offset + 4, offset + 8);
      if (type === 'acTL') return true;
      if (type === 'IEND') return false;
      offset = next;
    }
    return false;
  }

  private safeFilename(value: string): string {
    const basename = (value ?? '').split(/[\\/]/).pop() ?? '';
    const cleaned = basename
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[ .]+|[ .]+$/g, '');
    return [...cleaned].slice(0, 150).join('') || 'photo.jpg';
  }

  private unsupported(): UnsupportedMediaTypeException {
    return new UnsupportedMediaTypeException({
      code: 'PHOTO_FORMAT_UNSUPPORTED',
      message:
        '움직이지 않는 JPEG, PNG, WebP 사진만 가능합니다. HEIC 사진은 JPEG로 변환해 주세요.',
    });
  }

  private tooLarge(): PayloadTooLargeException {
    return new PayloadTooLargeException({
      code: 'PHOTO_TOO_LARGE',
      message: '사진은 10MiB 이하, 4천만 화소 이하로 업로드해 주세요.',
    });
  }

  private invalidPhoto(): BadRequestException {
    return new BadRequestException({
      code: 'PHOTO_INVALID',
      message: '사진을 처리할 수 없습니다. 정상적인 사진 파일을 선택해 주세요.',
    });
  }
}
