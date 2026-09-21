import { ImportRowAction, ImportRowStatus } from '@prisma/client';
import { flag, type PreviewRow } from './roster-preview';

export type ConflictStay = {
  id: string;
  propertyId: string;
  guestName: string;
  checkInAt: Date;
  checkOutAt: Date;
};

export function stayBounds(
  row: PreviewRow,
): { from: number; to: number } | null {
  const data = row.normalizedData;
  if (
    !data?.checkInDate ||
    !data.checkOutDate ||
    row.validationStatus === ImportRowStatus.INVALID
  )
    return null;
  const from = Date.parse(
    data.checkInAt ?? data.checkInDate + 'T00:00:00+09:00',
  );
  const to = data.checkOutAt
    ? Date.parse(data.checkOutAt)
    : Date.parse(data.checkOutDate + 'T00:00:00+09:00') + 86400_000;
  return Number.isFinite(from) && Number.isFinite(to) && to > from
    ? { from, to }
    : null;
}

export function checkRosterConflicts(
  rows: PreviewRow[],
  stays: ConflictStay[],
): void {
  const groups = new Map<
    string,
    Array<{ row: PreviewRow; from: number; to: number }>
  >();
  for (const row of rows) {
    if (row.action === ImportRowAction.SKIP) continue;
    const bounds = stayBounds(row);
    if (!bounds) continue;
    const groupKey = row.propertyId ?? row.sheetName;
    const group = groups.get(groupKey) ?? [];
    group.push({ row, ...bounds });
    groups.set(groupKey, group);
    const conflicts = stays.filter(
      (stay) =>
        stay.propertyId === row.propertyId &&
        stay.checkInAt.getTime() < bounds.to &&
        stay.checkOutAt.getTime() > bounds.from,
    );
    if (conflicts.length) {
      flag(
        row,
        'EXISTING_STAY_OVERLAP',
        '이미 등록된 이용 일정과 겹칩니다. 중복 또는 변경 여부를 확인해 주세요.',
      );
      row.validationMessages.find(
        (message) => message.code === 'EXISTING_STAY_OVERLAP',
      ).stayIds = conflicts.slice(0, 20).map((stay) => stay.id);
      const data = row.normalizedData;
      if (
        data.guestName &&
        conflicts.some(
          (stay) =>
            stay.guestName === data.guestName &&
            stay.checkInAt.toISOString() === data.checkInAt &&
            stay.checkOutAt.toISOString() === data.checkOutAt,
        )
      )
        flag(
          row,
          'POSSIBLE_EXISTING_DUPLICATE',
          '이름과 이용 시간이 같은 일정이 있습니다. 자동으로 합치지 않습니다.',
        );
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.from - b.from);
    for (let i = 0; i < group.length; i++) {
      for (
        let j = i + 1;
        j < group.length && group[j].from < group[i].to;
        j++
      ) {
        const left = group[i].row,
          right = group[j].row;
        const a = left.normalizedData,
          b = right.normalizedData;
        const exact =
          a.guestName !== null &&
          a.guestName === b.guestName &&
          a.checkInAt !== null &&
          a.checkInAt === b.checkInAt &&
          a.checkOutAt !== null &&
          a.checkOutAt === b.checkOutAt;
        for (const row of [left, right])
          flag(
            row,
            exact ? 'DUPLICATE_SOURCE_ROW' : 'SOURCE_STAY_OVERLAP',
            exact
              ? '파일 안에 이름과 이용 시간이 같은 행이 있습니다. 중복 여부를 확인해 주세요.'
              : '파일 안의 다른 이용 일정과 겹치거나 시간 확인이 필요합니다.',
          );
      }
    }
  }
}
