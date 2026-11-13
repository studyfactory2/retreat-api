import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module';
import { PropertyGuideFilesService } from './property-guide-files.service';
@Module({
  imports: [StorageModule],
  providers: [PropertyGuideFilesService],
  exports: [PropertyGuideFilesService],
})
export class PropertyGuideFilesModule {}
