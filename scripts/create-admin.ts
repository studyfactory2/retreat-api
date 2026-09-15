import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Prisma, Role } from '@prisma/client';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { AuthService } from '../src/components/auth/auth.service';
import { PrismaService } from '../src/database/prisma.service';

class SetupError extends Error {}

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  let prompt: ReturnType<typeof createInterface> | undefined;
  let hideInput = false;
  const cancellation = new AbortController();
  const cancel = (): void => cancellation.abort();
  process.on('SIGINT', cancel);

  try {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new SetupError('Run this command in an interactive terminal.');
    }
    if (process.argv.length > 2) {
      throw new SetupError(
        'Run without arguments. Enter credentials at the prompts.',
      );
    }

    const requireModule = createRequire(__filename);
    const { AppModule } = requireModule(
      '../src/app.module',
    ) as typeof import('../src/app.module');
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: false,
      abortOnError: false,
    });
    const prisma = app.get(PrismaService);
    const auth = app.get(AuthService);
    const existingAdmin = await prisma.user.findFirst({
      where: { role: Role.ADMIN },
      select: { id: true },
    });
    if (existingAdmin) {
      throw new SetupError(
        'An administrator already exists. No account was changed.',
      );
    }

    const output = new Writable({
      write(chunk: string | Buffer, encoding: BufferEncoding, callback) {
        if (!hideInput) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const terminal = createInterface({
      input: process.stdin,
      output,
      terminal: true,
      historySize: 0,
    });
    prompt = terminal;
    terminal.on('SIGINT', cancel);
    terminal.on('close', cancel);

    const ask = async (label: string, secret = false): Promise<string> => {
      cancellation.signal.throwIfAborted();
      process.stdout.write(label);
      hideInput = secret;
      try {
        return await terminal.question('', { signal: cancellation.signal });
      } finally {
        hideInput = false;
        if (secret) process.stdout.write('\n');
      }
    };

    const loginId = (await ask('Login ID: ')).trim();
    if (!loginId || loginId.length > 80) {
      throw new SetupError('Login ID must contain 1 to 80 characters.');
    }
    const name = (await ask('Administrator name: ')).trim();
    if (!name || name.length > 100) {
      throw new SetupError('Name must contain 1 to 100 characters.');
    }
    const password = await ask('Password (input hidden): ', true);
    if ([...password].length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new SetupError(
        'Password must contain at least 12 characters and at most 72 UTF-8 bytes.',
      );
    }
    const confirmation = await ask('Confirm password (input hidden): ', true);
    if (confirmation !== password) {
      throw new SetupError('Passwords do not match.');
    }

    cancellation.signal.throwIfAborted();
    const passwordHash = await auth.hashPassword(password);
    cancellation.signal.throwIfAborted();
    await prisma.$transaction(
      async (transaction) => {
        const admin = await transaction.user.findFirst({
          where: { role: Role.ADMIN },
          select: { id: true },
        });
        if (admin) {
          throw new SetupError(
            'An administrator already exists. No account was changed.',
          );
        }
        cancellation.signal.throwIfAborted();
        await transaction.user.create({
          data: {
            loginId,
            name,
            passwordHash,
            role: Role.ADMIN,
            isActive: true,
          },
          select: { id: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    process.stdout.write('Initial administrator created successfully.\n');
  } catch (error: unknown) {
    process.exitCode = 1;
    const message =
      error instanceof SetupError
        ? error.message
        : cancellation.signal.aborted
          ? 'Administrator setup cancelled.'
          : 'Administrator setup failed. Check configuration, migrations, database availability, and whether the login ID already exists.';
    process.stderr.write(message + '\n');
  } finally {
    hideInput = false;
    prompt?.close();
    try {
      await app?.close();
    } catch {
      process.exitCode = 1;
      process.stderr.write(
        'Could not close the database connection cleanly.\n',
      );
    }
    process.removeListener('SIGINT', cancel);
  }
}

void main();
