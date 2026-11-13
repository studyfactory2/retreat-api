import { Injectable, Logger, StreamableFile } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { GuidePdfStorageService } from '../../storage/guide-pdf-storage.service';
import {
  safePdfFilename,
  validateGuidePdf,
} from './property-guide-pdf-validation';

export interface GuidePdfFile {
  pdfBucket: string;
  pdfKey: string;
  pdfFilename: string;
  pdfSizeBytes: number;
}

@Injectable()
export class PropertyGuideFilesService {
  private readonly logger = new Logger(PropertyGuideFilesService.name);
  constructor(private readonly storage: GuidePdfStorageService) {}

  public async upload(
    propertyId: string,
    file: Express.Multer.File,
  ): Promise<GuidePdfFile> {
    const bucket = this.storage.getBucket();
    const { buffer, filename } = await validateGuidePdf(file);
    const key = `guides/${propertyId}/${randomUUID()}.pdf`;
    try {
      await this.storage.putPdf(
        key,
        buffer,
        createHash('sha256').update(buffer).digest('base64'),
      );
    } catch (error) {
      // A timed-out PUT can have reached S3. Delete only this never-published random key.
      await this.retire({ pdfBucket: bucket, pdfKey: key });
      throw error;
    }
    return {
      pdfBucket: bucket,
      pdfKey: key,
      pdfFilename: filename,
      pdfSizeBytes: buffer.length,
    };
  }

  public async download(file: GuidePdfFile): Promise<StreamableFile> {
    const bytes = await this.storage.getPdf(
      file.pdfBucket,
      file.pdfKey,
      file.pdfSizeBytes,
    );
    const filename = encodeURIComponent(
      safePdfFilename(file.pdfFilename),
    ).replace(
      /['()*]/g,
      (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
    );
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      length: bytes.length,
      disposition: `attachment; filename="retreat-guide.pdf"; filename*=UTF-8''${filename}`,
    });
  }

  public async retire(
    file: Pick<GuidePdfFile, 'pdfBucket' | 'pdfKey'> | null,
  ): Promise<void> {
    if (!file) return;
    try {
      await this.storage.deletePdf(file.pdfBucket, file.pdfKey);
    } catch {
      this.logger.warn(
        `Unused guide PDF cleanup failed; reconcile object ${file.pdfKey}`,
      );
    }
  }
}

export function guidePdfFile(guide: {
  pdfBucket: string | null;
  pdfKey: string | null;
  pdfFilename: string | null;
  pdfSizeBytes: number | null;
}): GuidePdfFile | null {
  if (
    !guide.pdfBucket ||
    !guide.pdfKey ||
    !guide.pdfFilename ||
    !guide.pdfSizeBytes
  )
    return null;
  return {
    pdfBucket: guide.pdfBucket,
    pdfKey: guide.pdfKey,
    pdfFilename: guide.pdfFilename,
    pdfSizeBytes: guide.pdfSizeBytes,
  };
}
