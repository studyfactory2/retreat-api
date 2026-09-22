import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { StorageModule } from '../../storage/storage.module';
import { UploadCleanupService } from './upload-cleanup.service';

@Module({
  imports: [DatabaseModule, StorageModule],
  providers: [UploadCleanupService],
  exports: [UploadCleanupService],
})
export class UploadCleanupModule {}
