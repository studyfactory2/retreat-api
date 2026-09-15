import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaysController } from './stays.controller';
import { StaysService } from './stays.service';

@Module({
  imports: [AuthModule],
  controllers: [StaysController],
  providers: [StaysService],
})
export class StaysModule {}
