import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { PropertiesModule } from './properties/properties.module';
import { StaysModule } from './stays/stays.module';
import { ChecklistTemplatesModule } from './checklist-templates/checklist-templates.module';
import { QrModule } from './qr/qr.module';
import { AdminPropertyQrModule } from './admin-property-qr/admin-property-qr.module';
import { SubmissionDraftsModule } from './submission-drafts/submission-drafts.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { AdminSubmissionsModule } from './admin-submissions/admin-submissions.module';
import { AdminIssuesModule } from './admin-issues/admin-issues.module';
import { AdminIssueCategoriesModule } from './admin-issue-categories/admin-issue-categories.module';
import { GuestIssuesModule } from './guest-issues/guest-issues.module';

@Module({
  imports: [
    HealthModule,
    AuthModule,
    UsersModule,
    AdminUsersModule,
    PropertiesModule,
    StaysModule,
    ChecklistTemplatesModule,
    QrModule,
    AdminPropertyQrModule,
    SubmissionDraftsModule,
    AttachmentsModule,
    SubmissionsModule,
    AdminSubmissionsModule,
    AdminIssuesModule,
    AdminIssueCategoriesModule,
    GuestIssuesModule,
  ],
})
export class ComponentsModule {}
