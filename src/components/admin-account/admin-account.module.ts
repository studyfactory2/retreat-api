import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { AdminAccountController } from './admin-account.controller';
import { AdminAccountService } from './admin-account.service';

@Module({
  imports: [AuthModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])],
  controllers: [AdminAccountController],
  providers: [AdminAccountService],
})
export class AdminAccountModule {}
