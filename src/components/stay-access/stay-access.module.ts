import { Module } from '@nestjs/common';
import { StayAccessService } from './stay-access.service';

@Module({
  providers: [StayAccessService],
  exports: [StayAccessService],
})
export class StayAccessModule {}
