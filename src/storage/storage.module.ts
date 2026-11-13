import { Module } from '@nestjs/common';
import { ImportSourceStorageService } from './import-source-storage.service';
import { GuidePdfStorageService } from './guide-pdf-storage.service';
import { S3Service } from './s3.service';

@Module({
  providers: [S3Service, ImportSourceStorageService, GuidePdfStorageService],
  exports: [S3Service, ImportSourceStorageService, GuidePdfStorageService],
})
export class StorageModule {}
