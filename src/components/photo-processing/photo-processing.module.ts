import { Module } from '@nestjs/common';
import { PhotoImageService } from './photo-image.service';
import { PhotoUploadCapacityInterceptor } from './photo-upload-capacity.interceptor';
import { PhotoUploadCapacityService } from './photo-upload-capacity.service';

@Module({
  providers: [
    PhotoImageService,
    PhotoUploadCapacityService,
    PhotoUploadCapacityInterceptor,
  ],
  exports: [
    PhotoImageService,
    PhotoUploadCapacityService,
    PhotoUploadCapacityInterceptor,
  ],
})
export class PhotoProcessingModule {}
