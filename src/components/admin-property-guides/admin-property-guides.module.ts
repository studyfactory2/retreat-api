import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { PropertyGuideFilesModule } from '../property-guide-files/property-guide-files.module';
import { GuidePdfUploadCapacityInterceptor } from './guide-pdf-upload-capacity.interceptor';
import { AuthModule } from '../auth/auth.module';
import { QrNoStoreMiddleware } from '../qr/qr-no-store.middleware';
import { AdminPropertyGuidesController } from './admin-property-guides.controller';
import { AdminPropertyGuidesService } from './admin-property-guides.service';

@Module({
  imports: [AuthModule, PropertyGuideFilesModule],
  controllers: [AdminPropertyGuidesController],
  providers: [
    AdminPropertyGuidesService,
    QrNoStoreMiddleware,
    GuidePdfUploadCapacityInterceptor,
  ],
})
export class AdminPropertyGuidesModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QrNoStoreMiddleware)
      .forRoutes(AdminPropertyGuidesController);
  }
}
