import {
  ChecklistTemplateVersionSource,
  Prisma,
  type PrismaClient,
  type ChecklistTemplateVersion,
} from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { parseChecklistDefinition } from './checklist-definition';

const PAGE_SIZE = 100;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const templateSelect = {
  id: true,
  version: true,
  title: true,
  definition: true,
  isActive: true,
  updatedAt: true,
} satisfies Prisma.ChecklistTemplateSelect;
type Template = Prisma.ChecklistTemplateGetPayload<{
  select: typeof templateSelect;
}>;

export type ChecklistBackfillReport = {
  mode: 'check' | 'apply';
  phase: 'preflight' | 'apply' | 'complete';
  preflight: {
    checked: number;
    needsBaseline: number;
    alreadyArchived: number;
  };
  applied: { checked: number; created: number; alreadyArchived: number };
};

class InspectionError extends Error {
  constructor(
    readonly code: string,
    readonly templateId: string,
  ) {
    super(code);
  }
}

export class ChecklistBackfillFailure extends Error {
  constructor(
    readonly code: string,
    readonly templateId: string | null,
    readonly report: ChecklistBackfillReport,
  ) {
    super(code);
  }
}

function fail(code: string, templateId: string): never {
  throw new InspectionError(code, templateId);
}

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    [...value].length <= maximum
  );
}

function validVersion(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 2147483647;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validateDefinition(value: Prisma.JsonValue, templateId: string): void {
  try {
    parseChecklistDefinition(value);
  } catch {
    fail('INVALID_DEFINITION', templateId);
  }
}

function validateTemplate(template: Template): void {
  if (
    !UUID_V4.test(template.id) ||
    !validVersion(template.version) ||
    !validText(template.title, 150) ||
    typeof template.isActive !== 'boolean' ||
    !validDate(template.updatedAt)
  )
    fail('INVALID_CURRENT_TEMPLATE', template.id);
  validateDefinition(template.definition, template.id);
}

function validateArchive(
  row: ChecklistTemplateVersion,
  templateId: string,
): void {
  const baseline = row.source === ChecklistTemplateVersionSource.BASELINE;
  const published = row.source === ChecklistTemplateVersionSource.PUBLISHED;
  if (
    row.templateId !== templateId ||
    !validVersion(row.version) ||
    !validText(row.title, 150) ||
    typeof row.isActive !== 'boolean' ||
    !validDate(row.publishedAt) ||
    (!baseline && !published) ||
    (baseline && (row.actorUserId !== null || row.actorName !== null)) ||
    (published &&
      (typeof row.actorUserId !== 'string' ||
        !UUID_V4.test(row.actorUserId) ||
        !validText(row.actorName, 100)))
  )
    fail('INVALID_ARCHIVED_VERSION', templateId);
  validateDefinition(row.definition, templateId);
}

async function inspect(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<{ template: Template; needsBaseline: boolean }> {
  const template = await tx.checklistTemplate.findUnique({
    where: { id },
    select: templateSelect,
  });
  if (!template) fail('TEMPLATE_CHANGED_DURING_BACKFILL', id);
  validateTemplate(template);
  let before: number | undefined;
  let expected = template.version;
  let found = false;
  let baselineSeen = false;
  for (;;) {
    const rows = await tx.checklistTemplateVersion.findMany({
      where: { templateId: id, ...(before ? { version: { lt: before } } : {}) },
      orderBy: { version: 'desc' },
      take: PAGE_SIZE,
    });
    if (!rows.length) break;
    for (const row of rows) {
      validateArchive(row, id);
      if (row.version !== expected || baselineSeen)
        fail('ARCHIVE_VERSION_GAP', id);
      if (!found) {
        if (
          row.title !== template.title ||
          row.isActive !== template.isActive ||
          row.publishedAt.getTime() !== template.updatedAt.getTime() ||
          !isDeepStrictEqual(row.definition, template.definition)
        )
          fail('CURRENT_ARCHIVE_MISMATCH', id);
      }
      found = true;
      baselineSeen = row.source === ChecklistTemplateVersionSource.BASELINE;
      expected -= 1;
    }
    before = rows[rows.length - 1].version;
    if (rows.length < PAGE_SIZE) break;
  }
  // A newly created template's history starts at v1; a legacy template may
  // start later only when its oldest known version is an explicit baseline.
  if (found && !baselineSeen && expected !== 0) fail('ARCHIVE_VERSION_GAP', id);
  return { template, needsBaseline: !found };
}

async function inTransaction<T>(
  prisma: PrismaClient,
  apply: boolean,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: apply
          ? Prisma.TransactionIsolationLevel.Serializable
          : Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5000,
        timeout: 30000,
      });
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        !['P2034', 'P2002'].includes(error.code)
      )
        throw error;
    }
  }
}

async function eachTemplate(
  prisma: PrismaClient,
  visit: (id: string) => Promise<void>,
): Promise<void> {
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.checklistTemplate.findMany({
      ...(after ? { where: { id: { gt: after } } } : {}),
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });
    if (!rows.length) return;
    for (const { id } of rows) await visit(id);
    after = rows[rows.length - 1].id;
    if (rows.length < PAGE_SIZE) return;
  }
}

/** Explicit operator command only. No API startup path calls this function. */
export async function backfillChecklistVersions(
  prisma: PrismaClient,
  options: { apply: boolean },
): Promise<ChecklistBackfillReport> {
  const report: ChecklistBackfillReport = {
    mode: options.apply ? 'apply' : 'check',
    phase: 'preflight',
    preflight: { checked: 0, needsBaseline: 0, alreadyArchived: 0 },
    applied: { checked: 0, created: 0, alreadyArchived: 0 },
  };
  let processingId: string | null = null;
  try {
    // Check all existing history before any writes, so known invalid archives
    // cannot cause an avoidable partial backfill. Writes revalidate each row.
    await eachTemplate(prisma, async (id) => {
      processingId = id;
      const result = await inTransaction(prisma, false, (tx) =>
        inspect(tx, id),
      );
      report.preflight.checked += 1;
      if (result.needsBaseline) report.preflight.needsBaseline += 1;
      else report.preflight.alreadyArchived += 1;
    });
    if (options.apply) {
      report.phase = 'apply';
      await eachTemplate(prisma, async (id) => {
        processingId = id;
        const created = await inTransaction(prisma, true, async (tx) => {
          const { template, needsBaseline } = await inspect(tx, id);
          if (!needsBaseline) return false;
          await tx.checklistTemplateVersion.create({
            data: {
              templateId: template.id,
              version: template.version,
              title: template.title,
              definition: template.definition,
              isActive: template.isActive,
              source: ChecklistTemplateVersionSource.BASELINE,
              actorUserId: null,
              actorName: null,
              publishedAt: template.updatedAt,
            },
          });
          return true;
        });
        report.applied.checked += 1;
        if (created) report.applied.created += 1;
        else report.applied.alreadyArchived += 1;
      });
    }
    report.phase = 'complete';
    return report;
  } catch (error) {
    throw new ChecklistBackfillFailure(
      error instanceof InspectionError ? error.code : 'BACKFILL_DATABASE_ERROR',
      error instanceof InspectionError ? error.templateId : processingId,
      report,
    );
  }
}
