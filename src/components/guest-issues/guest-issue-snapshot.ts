import type { Prisma } from '@prisma/client';

// Only a standalone guest report's validated first REPORTED event may use this
// compatibility rule. An explicit invalid value must still fail snapshot parsing.
export function normalizeLegacyGuestReportSnapshot(
  snapshot: Prisma.JsonValue,
): Prisma.JsonValue {
  if (
    snapshot !== null &&
    typeof snapshot === 'object' &&
    !Array.isArray(snapshot) &&
    !Object.prototype.hasOwnProperty.call(snapshot, 'isUrgent')
  ) {
    return { ...snapshot, isUrgent: false };
  }
  return snapshot;
}
