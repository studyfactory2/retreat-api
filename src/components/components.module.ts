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
import { AdminStayLinksModule } from './admin-stay-links/admin-stay-links.module';
import { GuestStaysModule } from './guest-stays/guest-stays.module';
import { GuestSubmissionsModule } from './guest-submissions/guest-submissions.module';
import { AdminStayImportsModule } from './admin-stay-imports/admin-stay-imports.module';
import { AdminSubmissionStaysModule } from './admin-submission-stays/admin-submission-stays.module';

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
    AdminStayLinksModule,
    GuestStaysModule,
    GuestSubmissionsModule,
    AdminStayImportsModule,
    AdminSubmissionStaysModule,
  ],
})
export class ComponentsModule {}
