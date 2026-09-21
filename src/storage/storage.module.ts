import { Module } from '@nestjs/common';
import { ImportSourceStorageService } from './import-source-storage.service';
import { S3Service } from './s3.service';

@Module({
  providers: [S3Service, ImportSourceStorageService],
  exports: [S3Service, ImportSourceStorageService],
})
export class StorageModule {}
