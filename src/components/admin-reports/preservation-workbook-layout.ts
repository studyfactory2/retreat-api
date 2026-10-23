import type {
  ArchiveSheetName,
  ArchiveTable,
  ArchiveValue,
  PreservationReport,
} from '../../libs/dto/admin-report/preservation-report';

export type ArchiveRowKind =
  | 'title'
  | 'metadata'
  | 'spacer'
  | 'header'
  | 'data'
  | 'section'
  | 'guide'
  | 'notice';
export interface ArchiveSheetLayout {
  name: string;
  rows: ArchiveValue[][];
  kinds: ArchiveRowKind[];
  widths: number[];
  heights: number[];
  merges: string[];
  headers?: string[];
  freezeRows: number;
  freezeColumns: number;
}

// Presentation order only. Reader contracts and positional history/photo rows
// remain unchanged; every original column is retained exactly once.
const leadingColumns: Record<ArchiveSheetName, string[]> = {
  '이용 일정': [
    '휴양소',
    '이용객',
    '입실 예정 (서울)',
    '퇴실 예정 (서울)',
    '상태',
  ],
  '점검 기록': [
    '휴양소',
    '구분',
    '방문일',
    '작성자',
    '상태',
    '사진 수',
    '이상 응답 수',
    '응답 수',
    '최초 제출 (서울)',
  ],
  '점검 답변': ['휴양소', '구분', '섹션', '질문', '응답', '이상 내용'],
  이상사항: [
    '휴양소',
    '제목',
    '처리 상태',
    '기록 상태',
    '긴급',
    '접수 시각 (서울)',
  ],
  '변경 이력': [
    '기록 종류',
    '기록 ID',
    '버전',
    '변경 종류',
    '항목',
    '변경 전',
    '변경 후',
  ],
  '사진 목록': [
    '파일명',
    '파일 상태',
    '용도',
    '기록 종류',
    '버전',
    '현재 버전',
    '등록 시각 (서울)',
  ],
};

function columnWidth(header: string): number {
  const widths: Record<string, number> = {
    휴양소: 28,
    이용객: 18,
    작성자: 18,
    변경자: 18,
    구분: 10,
    방문일: 14,
    회사: 20,
    부서: 18,
    연락처: 18,
    상태: 12,
    '처리 상태': 14,
    '기록 상태': 12,
    응답: 12,
    '파일 상태': 30,
    파일명: 32,
    '파일 형식': 20,
    '기록 종류': 14,
    '변경 종류': 14,
    '작성 경로': 18,
    '등록 경로': 16,
    경로: 18,
    역할: 12,
    용도: 14,
    긴급: 10,
    '필수 항목': 12,
    '직원 조치 기록': 16,
    섹션: 22,
    제목: 36,
    항목: 28,
    질문: 46,
  };
  return (
    widths[header] ??
    (/ID/.test(header)
      ? 38
      : /시각|서울/.test(header)
        ? 24
        : /내용|메모|사유|변경 전|변경 후/.test(header)
          ? 48
          : /버전|응답 수|사진 수|정렬/.test(header)
            ? 10
            : /바이트/.test(header)
              ? 16
              : 24)
  );
}

/** Approximate display width, without treating ASCII IDs as Korean text. */
export function wrappedLines(value: ArchiveValue, width: number): number {
  if (typeof value !== 'string') return 1;
  return value.split(/\r\n|\r|\n/).reduce((total, line) => {
    const units = Array.from(line).reduce(
      (sum, char) => sum + ((char.codePointAt(0) ?? 0) > 255 ? 2 : 1),
      0,
    );
    return total + Math.max(1, Math.ceil(units / Math.max(1, width - 2)));
  }, 0);
}

export function archiveTableLayout(
  data: PreservationReport,
  table: ArchiveTable,
): ArchiveSheetLayout {
  const leading = leadingColumns[table.name];
  if (leading.some((header) => !table.headers.includes(header)))
    throw new Error('Missing preservation presentation column');
  const headers = [
    ...leading,
    ...table.headers.filter((h) => !leading.includes(h)),
  ];
  const indices = headers.map((h) => table.headers.indexOf(h));
  const values = table.rows.map((row) => indices.map((index) => row[index]));
  const widths = headers.map(columnWidth);
  const rows: ArchiveValue[][] = [
    [table.name, null, null, `${table.rows.length.toLocaleString('ko-KR')}행`],
    [`휴양소  ${data.propertyLabel}`, null, null, `${data.from} ~ ${data.to}`],
    [
      '출력 (서울)',
      data.generatedAt,
      null,
      '필터로 조회 · 긴 내용은 행 높이를 늘려 확인',
    ],
    [],
    headers,
    ...values,
  ];
  return {
    name: table.name,
    rows,
    headers,
    widths,
    kinds: [
      'title',
      'metadata',
      'metadata',
      'spacer',
      'header',
      ...values.map(() => 'data' as const),
    ],
    heights: [
      34,
      Math.max(
        24,
        wrappedLines(
          rows[1][0],
          widths.slice(0, 3).reduce((a, b) => a + b, 0),
        ) *
          15 +
          8,
      ),
      Math.max(
        26,
        wrappedLines(
          rows[2][3],
          widths.slice(3, 6).reduce((a, b) => a + b, 0),
        ) *
          15 +
          8,
      ),
      9,
      34,
      ...values.map((row) =>
        Math.min(
          54,
          Math.max(
            28,
            ...row.map(
              (value, column) => wrappedLines(value, widths[column]) * 15 + 9,
            ),
          ),
        ),
      ),
    ],
    merges: ['A1:C1', 'D1:F1', 'A2:C2', 'D2:F2', 'B3:C3', 'D3:F3'],
    freezeRows: 5,
    freezeColumns: table.name === '변경 이력' ? 2 : 1,
  };
}

export function archiveGuideLayout(
  data: PreservationReport,
): ArchiveSheetLayout {
  const descriptions: Record<ArchiveSheetName, string> = {
    '이용 일정': '예약·입퇴실 예정·취소 기록',
    '점검 기록': '입실·퇴실·정비의 최신 저장 내용',
    '점검 답변': '질문별 응답·이상 내용·직원 조치',
    이상사항: '신고 내용·처리 상태·취소 기록',
    '변경 이력': '최초 저장과 모든 변경 전·후 값',
    '사진 목록': '버전별 사진 정보와 파일 상태',
  };
  const rows: ArchiveValue[][] = [];
  const kinds: ArchiveRowKind[] = [];
  const heights: number[] = [];
  const merges: string[] = [];
  const widths = [24, 16, 16, 20, 18, 24];
  const add = (
    values: ArchiveValue[],
    kind: ArchiveRowKind,
    height: number,
    spans: string[] = [],
  ) => {
    rows.push(values);
    kinds.push(kind);
    heights.push(height);
    spans.forEach((span) =>
      merges.push(span.replaceAll('#', String(rows.length))),
    );
  };
  const note = (
    label: string,
    text: string,
    kind: ArchiveRowKind = 'guide',
  ) => {
    add([label, text], kind, Math.max(30, wrappedLines(text, 94) * 16 + 12), [
      'B#:F#',
    ]);
  };
  add(['휴양소 기록 보관'], 'title', 38, ['A1:F1']);
  add(
    ['선택한 기간의 기록과 변경 이력을 한 파일에서 확인하세요.'],
    'metadata',
    26,
    ['A2:F2'],
  );
  add([], 'spacer', 10);
  add(
    [
      '휴양소',
      data.propertyLabel,
      null,
      '선택 기간',
      `${data.from} ~ ${data.to}`,
    ],
    'guide',
    Math.max(28, wrappedLines(data.propertyLabel, 32) * 16 + 10),
    ['B4:C4', 'E4:F4'],
  );
  add(
    [
      '출력 시각 (서울)',
      data.generatedAt,
      null,
      '시간 기준',
      '한국 시간 · UTC+09:00',
    ],
    'guide',
    28,
    ['B5:C5', 'E5:F5'],
  );
  add([], 'spacer', 10);
  add(['시트', null, null, '행 수', '포함 내용'], 'header', 32, [
    'A7:C7',
    'E7:F7',
  ]);
  data.tables.forEach((table) =>
    add(
      [table.name, null, null, table.rows.length, descriptions[table.name]],
      'data',
      36,
      ['A#:C#', 'E#:F#'],
    ),
  );
  add([], 'spacer', 12);
  add(['읽는 방법'], 'section', 30, ['A#:F#']);
  note(
    '필터와 고정',
    '각 시트 5행의 필터로 기록을 찾으세요. 제목 행과 왼쪽 식별 열은 스크롤해도 유지됩니다.',
  );
  note(
    '긴 내용 확인',
    '긴 메모는 셀을 선택하거나 행 높이를 늘려 전체 내용을 확인하세요. 원문은 생략 없이 저장됩니다.',
  );
  note(
    '상태 읽기',
    '정상·조치 완료는 초록색, 이상·긴급은 빨간색, 취소·삭제는 회색으로 표시합니다. 상태 문구를 함께 확인하세요.',
  );
  note(
    '사진 보관',
    '사진 목록만 포함합니다. 사진 원본 파일과 다운로드 링크는 이 엑셀에 포함하지 않습니다.',
    'notice',
  );
  add([], 'spacer', 12);
  add(['포함 범위와 기준'], 'section', 30, ['A#:F#']);
  note(
    '이용 일정',
    '선택 기간과 겹치는 일정이며 취소된 일정도 포함합니다. 입실·퇴실은 예정 시각으로, 실제 입퇴실을 증명하지 않습니다.',
  );
  note(
    '점검 기록',
    '최초 제출일이 선택 기간에 속하는 입실·퇴실·정비 기록입니다. 취소됨을 포함하고 작성 중인 기록은 제외합니다.',
  );
  note(
    '이상사항',
    '접수일이 선택 기간에 속하는 이상사항입니다. 취소된 신고도 포함합니다.',
  );
  note(
    '현재 내용과 이력',
    '주요 시트는 다운로드 조회 시점의 최신 저장 내용입니다. 이력은 최초 저장부터 모든 버전을 포함하므로 선택 기간 이후의 변경도 표시됩니다. 기간 말일의 상태가 아닙니다.',
  );
  note(
    '변경 이력 읽기',
    '기록 종류·기록 ID·버전으로 묶어 보세요. 최초 값은 변경 후 열에, 이후 변경은 변경 전·후 열에 표시합니다. 빈 칸은 값이 없음을 뜻하며, 같은 버전의 모든 행은 하나의 변경입니다.',
  );
  note(
    '질문과 이름',
    '기록에 저장된 당시 질문과 이름입니다. 현재 휴양소·직원·체크리스트 이름과 다를 수 있습니다.',
  );
  note(
    '사진 목록',
    '각 버전 또는 이상사항 이벤트에 연결된 목록으로 같은 사진 ID가 반복될 수 있습니다. 파일 상태는 데이터베이스 기준이며 실제 저장 파일은 확인하지 않았습니다. 목록만으로 원본이 보관되지는 않습니다.',
  );
  note(
    '연결 ID',
    '제출·일정·이상사항·사진 ID로 시트를 연결합니다. 연결된 다른 기록이 선택 기간 밖에 있으면 해당 행은 포함되지 않을 수 있습니다. 연락처와 ID는 텍스트로 저장되어 앞자리 0이 유지됩니다.',
  );
  note(
    '제외 항목',
    '로그인 정보·QR/개인 링크·차량번호·사진 파일·작성 중 기록은 제외합니다. 앱에 다시 업로드하여 복구하는 파일은 아닙니다.',
  );
  note(
    '다운로드 제한',
    '최대 62일, 대상 기록 5,000건, 버전/이벤트 10,000건, 상세 행 합계 50,000행, 텍스트 32 MiB, 파일 16 MiB입니다. 초과하면 일부만 저장하지 않고 범위를 줄이도록 안내합니다.',
  );
  return {
    name: '안내',
    rows,
    kinds,
    widths,
    heights,
    merges,
    freezeRows: 0,
    freezeColumns: 0,
  };
}
