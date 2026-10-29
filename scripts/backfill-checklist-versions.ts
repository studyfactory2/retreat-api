import { PrismaClient } from '@prisma/client';
import { existsSync } from 'node:fs';
import {
  backfillChecklistVersions,
  ChecklistBackfillFailure,
} from '../src/components/checklist-templates/checklist-version-backfill';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Usage: npm run checklist:versions:backfill -- [--apply]\n' +
        'Default: read-only preflight. --apply creates missing baseline history.\n' +
        'Apply the schema migration first. Keep the old API stopped until the\n' +
        'backfill and new API cutover are complete. Existing history is never overwritten.\n' +
        'This command uses DATABASE_URL from the environment or local .env.\n' +
        'Use --help alone without loading configuration or connecting to a database.\n',
    );
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    process.exitCode = 1;
    process.stderr.write(
      'Invalid arguments. Use npm run checklist:versions:backfill -- --help.\n',
    );
    return;
  }
  let prisma: PrismaClient | undefined;
  try {
    // Node22 is also used by the operator image. Existing environment variables
    // take precedence over .env; do not print the URL or raw database errors.
    if (existsSync('.env')) process.loadEnvFile('.env');
    if (!process.env.DATABASE_URL) throw new Error('Missing database URL');
    prisma = new PrismaClient({ errorFormat: 'minimal' });
    const report = await backfillChecklistVersions(prisma, {
      apply: args[0] === '--apply',
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof ChecklistBackfillFailure) {
      process.stderr.write(
        JSON.stringify(
          {
            error: error.code,
            templateId: error.templateId,
            ...error.report,
          },
          null,
          2,
        ) + '\n',
      );
      process.stderr.write(
        error.report.phase === 'preflight'
          ? 'Preflight failed; this command attempted no writes.\n'
          : 'Backfill stopped. Earlier templates may have been completed; the report lists confirmed creations. Resolve the failure before retrying. Matching baselines are safe to rerun.\n',
      );
    } else {
      process.stderr.write(
        'Backfill could not start. Check configuration, generated Prisma Client and database availability.\n',
      );
    }
  } finally {
    try {
      await prisma?.$disconnect();
    } catch {
      process.exitCode = 1;
      process.stderr.write(
        'Could not close the database connection cleanly.\n',
      );
    }
  }
}

void main();
