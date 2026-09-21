import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ActorSource,
  IssueEventType,
  IssueStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { runSerializableTransaction } from '../../database/serializable-transaction';
import type {
  GuestIssueCategoryListDto,
  GuestIssueReceiptDto,
} from '../../libs/dto/guest-issue/guest-issue';
import type {
  GetGuestIssueCategoriesInput,
  ReportGuestIssueInput,
} from '../../libs/dto/guest-issue/guest-issue.input';
import { QrFlow } from '../../libs/dto/qr/qr';
import {
  buildIssueSnapshot,
  parseIssueActor,
  parseIssueSnapshot,
} from '../../libs/issues/issue-snapshot';
import { QrService } from '../qr/qr.service';
import { GuestIssuePhotoClaimsService } from '../guest-issue-photos/guest-issue-photo-claims.service';

const reportSelect = {
  id: true,
  propertyId: true,
  events: {
    where: { version: 1 },
    select: {
      id: true,
      type: true,
      actorSource: true,
      actorUserId: true,
      actorSnapshot: true,
      sourceRevisionId: true,
      fromStatus: true,
      toStatus: true,
      snapshot: true,
      createdAt: true,
    },
  },
} satisfies Prisma.IssueSelect;

type StoredReport = Prisma.IssueGetPayload<{ select: typeof reportSelect }>;
type ReportContent = Pick<
  ReportGuestIssueInput,
  'categoryId' | 'guestName' | 'title'
> & {
  description: string | null;
};

@Injectable()
export class GuestIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
    private readonly photoClaims: GuestIssuePhotoClaimsService,
  ) {}

  public async getCategories(
    authorization: string | undefined,
    input: GetGuestIssueCategoriesInput,
  ): Promise<GuestIssueCategoryListDto> {
    void input;
    return await this.prisma.$transaction(
      async (tx) => {
        await this.qrService.resolveProperty(tx, QrFlow.GUEST, authorization);
        const items = await tx.issueCategory.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        });
        return { items };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  public async reportIssue(
    authorization: string | undefined,
    input: ReportGuestIssueInput,
  ): Promise<GuestIssueReceiptDto> {
    const content: ReportContent = {
      categoryId: input.categoryId.toLowerCase(),
      guestName: input.guestName.trim(),
      title: input.title.trim(),
      description: input.description?.trim() || null,
    };
    // A concurrent insert can win the unique request key before this transaction.
    // Re-enter with a fresh snapshot to return its receipt or reject changed content.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await runSerializableTransaction(this.prisma, async (tx) => {
          const property = await this.qrService.resolveProperty(
            tx,
            QrFlow.GUEST,
            authorization,
          );
          const requestKey = `guest-issue:${property.id}:${input.requestKey.toLowerCase()}`;
          const existing = await tx.issue.findUnique({
            where: { requestKey },
            select: reportSelect,
          });
          if (existing) {
            const receipt = this.existingReceipt(
              existing,
              property.id,
              content,
            );
            await this.photoClaims.assertReportedPhotos(
              tx,
              property.id,
              existing.events[0].id,
              input.photos ?? [],
            );
            return receipt;
          }

          const category = await tx.issueCategory.findFirst({
            where: { id: content.categoryId, isActive: true },
            select: { id: true, name: true },
          });
          if (!category) {
            throw new ConflictException({
              code: 'ISSUE_CATEGORY_UNAVAILABLE',
              message:
                '사용할 수 없는 분류입니다. 분류 목록을 다시 불러와 주세요.',
            });
          }

          const reportedAt = new Date();
          const issue = await tx.issue.create({
            data: {
              requestKey,
              propertyId: property.id,
              categoryId: category.id,
              title: content.title,
              description: content.description,
              isUrgent: false,
              status: IssueStatus.NEW,
              currentVersion: 1,
              reportedAt,
              updatedAt: reportedAt,
            },
          });
          const record = {
            ...issue,
            property: {
              id: property.id,
              name: property.name,
              region: property.region,
            },
            category,
            source: null,
          };
          const event = await tx.issueEvent.create({
            data: {
              issueId: issue.id,
              version: 1,
              type: IssueEventType.REPORTED,
              actorSource: ActorSource.GUEST_QR,
              actorUserId: null,
              actorSnapshot: {
                schemaVersion: 1,
                id: null,
                role: Role.GUEST,
                name: content.guestName,
              },
              sourceRevisionId: null,
              fromStatus: null,
              toStatus: IssueStatus.NEW,
              note: content.description,
              snapshot: buildIssueSnapshot(record, requestKey),
              createdAt: reportedAt,
            },
          });
          await this.photoClaims.attachToReport(
            tx,
            property.id,
            event.id,
            input.photos ?? [],
          );
          return {
            issueId: issue.id,
            status: 'RECEIVED',
            property: { id: property.id, name: property.name },
            receivedAt: reportedAt,
          };
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002' ||
          !Array.isArray(error.meta?.target) ||
          error.meta.target.length !== 1 ||
          error.meta.target[0] !== 'requestKey'
        ) {
          throw error;
        }
        if (attempt >= 1) {
          throw new ConflictException({
            code: 'CONCURRENT_UPDATE',
            message: '다른 요청이 처리 중입니다. 잠시 후 다시 시도해 주세요.',
          });
        }
      }
    }
  }

  private existingReceipt(
    report: StoredReport,
    propertyId: string,
    content: ReportContent,
  ): GuestIssueReceiptDto {
    const event = report.events[0];
    if (
      report.propertyId !== propertyId ||
      report.events.length !== 1 ||
      !event ||
      event.type !== IssueEventType.REPORTED ||
      event.actorSource !== ActorSource.GUEST_QR ||
      event.actorUserId !== null ||
      event.sourceRevisionId !== null ||
      event.fromStatus !== null ||
      event.toStatus !== IssueStatus.NEW
    )
      throw this.invalidReport();
    const original = parseIssueSnapshot(event.snapshot, {
      issueId: report.id,
      propertyId,
      version: 1,
    });
    const actor = parseIssueActor(event.actorSnapshot, null);
    if (
      original.source !== null ||
      original.status !== IssueStatus.NEW ||
      original.updatedAt.getTime() !== event.createdAt.getTime() ||
      original.reportedAt.getTime() !== event.createdAt.getTime()
    )
      throw this.invalidReport();
    if (
      original.category.id !== content.categoryId ||
      original.title !== content.title ||
      original.description !== content.description ||
      actor.name !== content.guestName
    ) {
      throw new ConflictException({
        code: 'ISSUE_REQUEST_CHANGED',
        message: '이미 접수된 요청의 내용이 다릅니다. 새 신고로 작성해 주세요.',
      });
    }
    return {
      issueId: report.id,
      status: 'RECEIVED',
      property: { id: original.property.id, name: original.property.name },
      receivedAt: original.reportedAt,
    };
  }

  private invalidReport(): InternalServerErrorException {
    return new InternalServerErrorException({
      code: 'INVALID_ISSUE_RECORD',
      message: '저장된 신고 기록을 불러올 수 없습니다.',
    });
  }
}
