import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PropertiesModule } from './properties/properties.module';
import { StaysModule } from './stays/stays.module';
import { ChecklistTemplatesModule } from './checklist-templates/checklist-templates.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    UsersModule,
    PropertiesModule,
    StaysModule,
    ChecklistTemplatesModule,
  ],
})
export class ComponentsModule {}
