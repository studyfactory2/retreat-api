# retreat-api project reference

## Product and working agreement

QR-based retreat operations for guests, cleaning staff, and one administrator.
Five properties initially; a sixth may follow. Client-facing text is Korean;
code and technical documentation are English.

Implement one approved slice at a time. The user controls staging, commits,
pushes, database migrations, and deployment. After implementation, report the
checks performed and provide one commit message. Keep unrelated user changes.

## Runtime decisions

- NestJS 11 and TypeScript, managed with npm.
- Local configuration in .env only; no .env.example.
- Default port 3100.
- No global /api prefix.
- PostgreSQL through Prisma 5.22.0, matching jagong-api exactly.
- prisma and @prisma/client must remain on the same version.
- The user runs npx prisma migrate dev --name <name> for development migrations.
- Runtime environment variables override .env.

## Structure

- src/main.ts: process startup, listening, graceful shutdown.
- src/config/: validated runtime settings and shared HTTP setup.
- src/components/: one module per feature, registered in components.module.ts.
- src/libs/dto/<feature>/: input DTOs and response contracts.
- src/libs/filters/: common exception handling.
- src/database/: global DatabaseModule and injectable PrismaService.
- prisma/schema.prisma: PostgreSQL datasource and future models.
- prisma/migrations/: created by the user's first development migration.

This follows the familiar Jagong module and DTO organization. Keep feature
logic in its own service when needed. Avoid creating empty feature modules.

## HTTP conventions

- English routes; Korean user-facing messages.
- Use request DTO classes with class-validator decorators.
- Unexpected properties and invalid DTO values return 400.
- Implicit type conversion is disabled. Add explicit conversions where needed.
- Return typed success payloads directly; errors use the common error response.
- Public errors use an HttpException subclass with an object containing code
  and message. Example: BadRequestException({ code: 'INVALID_STAY',
  message: '이용 일정을 확인해 주세요.' }).
- Unmarked HTTP error messages fall back to safe Korean status messages.
- All 5xx messages are generic in responses; diagnostic stacks stay in server
  logs. Error paths omit query strings.
- Validation errors add an errors array of field names and messages. Never
  include input values or sensitive data in validation message templates.
- CORS is an origin allowlist, with credentials disabled. It is not authorization.
- Configure production and HTTP tests through the same configureApp function.

## Slice 1 completion boundary

GET /health returns application liveness, not database or storage readiness.
The old starter routes were removed. Tests cover environment validation and
the shared HTTP behavior.

## Slice 2 completion boundary

The API requires DATABASE_URL and connects to PostgreSQL during module
initialization. PrismaService disconnects on application shutdown. Startup
failure also closes application resources; connection credentials are not logged.

Use the global PrismaService directly in feature services, following Jagong's
organization. No Prisma 7 adapter, generated source directory, or prisma.config.ts
is needed with the selected Prisma 5.22.0 setup.

No business models, migration, or seed are defined in this slice. A dedicated
empty local development database is sufficient to verify the connection.
The user runs development migrations after the table design is approved.
Client generation uses --allow-no-models until then; postinstall and prebuild
generate the client without altering the database.

HTTP tests replace PrismaService so they cannot connect to a developer database.
Live connection verification is a separate check. Authentication, business
records, and uploads remain unimplemented.

## Confirmed domain constraints for later slices

- Guest and staff QR links are separate per property.
- A QR resolves context; it does not independently verify a person's identity.
- Staff upload after-cleaning photos; before photos are not required.
- Descriptions/photos for reported defects are optional.
- Manager confirmation closes an issue; normal cleaning completion is separate.
- Preserve original submitted wording and answers when checklist templates change.
- Keep correction and cancellation history.
- Guest editing, bulk checklist updates, room interpretation, Excel details, and
  report format await the current client clarification.
- Calendar, roster import, and missing-submission detection are separate slices.

## References

- Nest configuration: https://docs.nestjs.com/techniques/configuration
- Nest CORS: https://docs.nestjs.com/security/cors
