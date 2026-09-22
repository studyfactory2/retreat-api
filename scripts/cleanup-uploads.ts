import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';

class ArgumentError extends Error {}

function parseArguments(args: string[]): {
  execute: boolean;
  limit: number;
  help: boolean;
} {
  const options = { execute: false, limit: 100, help: false };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (
      !['--execute', '--limit', '--help'].includes(argument) ||
      seen.has(argument)
    )
      throw new ArgumentError();
    seen.add(argument);
    if (argument === '--execute') {
      options.execute = true;
    } else if (argument === '--help') {
      options.help = true;
    } else {
      const value = args[++index];
      if (
        value === undefined ||
        !/^[1-9]\d{0,2}$/.test(value) ||
        Number(value) > 500
      )
        throw new ArgumentError();
      options.limit = Number(value);
    }
  }
  if (options.help && args.length !== 1) throw new ArgumentError();
  return options;
}

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    const { help, ...options } = parseArguments(process.argv.slice(2));
    if (help) {
      process.stdout.write(
        'Usage: npm run uploads:cleanup -- [--execute] [--limit 100]\n' +
          'Preview is the default. --execute applies cleanup.\n' +
          '--limit must be an integer from 1 to 500 (default: 100).\n' +
          'Use --help alone to show this message without loading configuration or connecting to the database.\n',
      );
      return;
    }

    const requireModule = createRequire(__filename);
    const { UploadCleanupCommandModule } = requireModule(
      '../src/components/upload-cleanup/upload-cleanup-command.module',
    ) as typeof import('../src/components/upload-cleanup/upload-cleanup-command.module');
    const { UploadCleanupService } = requireModule(
      '../src/components/upload-cleanup/upload-cleanup.service',
    ) as typeof import('../src/components/upload-cleanup/upload-cleanup.service');
    app = await NestFactory.createApplicationContext(
      UploadCleanupCommandModule,
      { logger: false, abortOnError: false },
    );
    const result = await app.get(UploadCleanupService).run(options);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.failed > 0) process.exitCode = 1;
  } catch (error: unknown) {
    process.exitCode = 1;
    process.stderr.write(
      error instanceof ArgumentError
        ? 'Invalid arguments. Use npm run uploads:cleanup -- --help.\n'
        : 'Upload cleanup failed. Check configuration, migrations, database and storage availability.\n',
    );
  } finally {
    try {
      await app?.close();
    } catch {
      process.exitCode = 1;
      process.stderr.write(
        'Upload cleanup could not close its database connection cleanly.\n',
      );
    }
  }
}

void main();
