import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChecklistTemplatesController } from './checklist-templates.controller';
import { ChecklistTemplatesService } from './checklist-templates.service';

@Module({
  imports: [AuthModule],
  controllers: [ChecklistTemplatesController],
  providers: [ChecklistTemplatesService],
})
export class ChecklistTemplatesModule {}
