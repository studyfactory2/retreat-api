import { Injectable } from '@nestjs/common';
import { ChecklistType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type {
  GetGuestStayInput,
  StartStayGuestDraftInput,
} from '../../libs/dto/guest-stay/guest-stay.input';
import type { GuestStayDto } from '../../libs/dto/guest-stay/guest-stay';
import type { StartDraftDto } from '../../libs/dto/submission-draft/submission-draft';
import { parseChecklistDefinition } from '../checklist-templates/checklist-definition';
import { StayAccessService } from '../stay-access/stay-access.service';
import { SubmissionDraftsService } from '../submission-drafts/submission-drafts.service';

@Injectable()
export class GuestStaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stayAccessService: StayAccessService,
    private readonly submissionDraftsService: SubmissionDraftsService,
  ) {}

  public async getCurrent(
    authorization: string | undefined,
    input: GetGuestStayInput,
  ): Promise<GuestStayDto> {
    void input;
    return await this.prisma.$transaction(
      async (tx) => {
        const stay = await this.stayAccessService.resolveStay(
          tx,
          authorization,
        );
        const templates = await tx.checklistTemplate.findMany({
          where: {
            propertyId: stay.propertyId,
            type: { in: [ChecklistType.CHECK_IN, ChecklistType.CHECK_OUT] },
            isActive: true,
          },
          select: {
            id: true,
            type: true,
            title: true,
            version: true,
            definition: true,
          },
          orderBy: { type: 'asc' },
        });
        return {
          stayId: stay.id,
          guestName: stay.guestName,
          checkInAt: stay.checkInAt,
          checkOutAt: stay.checkOutAt,
          expiresAt: stay.guestLinkExpiresAt,
          property: {
            id: stay.property.id,
            name: stay.property.name,
            region: stay.property.region,
            vehicleRegistrationEnabled:
              stay.property.vehicleRegistrationEnabled,
          },
          checklists: templates.map((template) => ({
            id: template.id,
            type: template.type,
            title: template.title,
            version: template.version,
            definition: parseChecklistDefinition(template.definition),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async startGuestDraft(
    authorization: string | undefined,
    input: StartStayGuestDraftInput,
  ): Promise<StartDraftDto> {
    return await this.submissionDraftsService.startStayGuestDraft(
      authorization,
      input,
    );
  }
}
