import * as XLSX from 'xlsx';
import type { ArchiveValue } from '../../libs/dto/admin-report/preservation-report';
import type { ArchiveSheetLayout } from './preservation-workbook-layout';

// SheetJS exposes its ZIP codec without TypeScript declarations. This adapter
// accepts only our freshly generated workbook, never an uploaded archive.
interface ZipArchive {
  FileIndex: { name: string; content: Uint8Array }[];
  FullPaths: string[];
}
interface ZipCodec {
  read(data: Buffer, options: { type: 'buffer' }): ZipArchive;
  find(zip: ZipArchive, path: string): { content: Uint8Array } | null;
  utils: { cfb_add(zip: ZipArchive, path: string, data: Buffer): void };
  write(
    zip: ZipArchive,
    options: { type: 'buffer'; fileType: 'zip'; compression: boolean },
  ): unknown;
}
type Tone =
  | 'body'
  | 'muted'
  | 'bold'
  | 'white'
  | 'title'
  | 'green'
  | 'red'
  | 'gray'
  | 'blue'
  | 'amber';
type Fill =
  'plain' | 'stripe' | 'navy' | 'blue' | 'green' | 'red' | 'gray' | 'amber';
interface CellAppearance {
  tone: Tone;
  fill: Fill;
  border: number;
  align: 'left' | 'center' | 'right';
}

function appearance(
  layout: ArchiveSheetLayout,
  row: number,
  column: number,
): CellAppearance {
  const value: ArchiveValue | undefined = layout.rows[row][column];
  const kind = layout.kinds[row];
  const header = layout.headers?.[column] ?? '';
  const result: CellAppearance = {
    tone: 'body',
    fill: 'plain',
    border: 0,
    align: typeof value === 'number' ? 'right' : 'left',
  };
  if (kind === 'title')
    return {
      ...result,
      tone: column === 0 ? 'title' : 'blue',
      align: column === 3 ? 'right' : 'left',
    };
  if (kind === 'header')
    return {
      ...result,
      tone: 'white',
      fill: 'navy',
      border: 2,
      align: 'center',
    };
  if (kind === 'metadata') return { ...result, tone: 'muted' };
  if (kind === 'section')
    return { ...result, tone: 'bold', fill: 'blue', border: 1 };
  if (kind === 'notice')
    return {
      ...result,
      tone: column === 0 ? 'amber' : 'body',
      fill: 'amber',
      border: 1,
    };
  if (kind === 'guide')
    return {
      ...result,
      tone: column === 0 || (row < 5 && column === 3) ? 'bold' : 'body',
      border: 1,
    };
  if (kind !== 'data') return result;
  result.fill = row % 2 === 0 ? 'stripe' : 'plain';
  result.border = 1;
  if (!layout.headers && column === 3)
    return { ...result, tone: 'bold', align: 'center' };
  if (column === 0) result.tone = layout.headers ? 'bold' : 'blue';
  if (/ID/.test(header)) result.tone = 'muted';
  if (header === '이상 응답 수' && typeof value === 'number' && value > 0)
    return { ...result, tone: 'red', fill: 'red' };
  // Colors supplement the saved label; never infer state from a note or ID.
  if (
    ['상태', '응답', '처리 상태', '기록 상태', '긴급', '파일 상태'].includes(
      header,
    )
  ) {
    const label = String(value ?? '');
    if (['정상', '조치 완료', '유효'].includes(label))
      return { ...result, tone: 'green', fill: 'green', align: 'center' };
    if (['이상', '긴급'].includes(label))
      return { ...result, tone: 'red', fill: 'red', align: 'center' };
    if (['취소됨', '삭제됨', '미응답'].includes(label))
      return { ...result, tone: 'gray', fill: 'gray', align: 'center' };
    if (['사용 불가', '등록됨 · 파일 확인 전'].includes(label))
      return { ...result, tone: 'amber', fill: 'amber' };
    if (['제출됨', '예약', '신규 접수', '조치 중'].includes(label))
      return { ...result, tone: 'blue', fill: 'blue', align: 'center' };
  }
  return result;
}

function appendStyles(
  xml: string,
  tag: string,
  additions: string[],
): { xml: string; start: number } {
  const block = xml.match(
    new RegExp('<' + tag + ' count="(\\d+)">([\\s\\S]*?)<\\/' + tag + '>'),
  );
  if (!block) throw new Error('Unexpected generated workbook styles: ' + tag);
  const start = Number(block[1]);
  return {
    xml: xml.replace(
      block[0],
      '<' +
        tag +
        ' count="' +
        (start + additions.length) +
        '">' +
        block[2] +
        additions.join('') +
        '</' +
        tag +
        '>',
    ),
    start,
  };
}

export function stylePreservationWorkbook(
  buffer: Buffer,
  layouts: ArchiveSheetLayout[],
): Buffer {
  const codec = XLSX.CFB as unknown as ZipCodec;
  const zip = codec.read(buffer, { type: 'buffer' });
  const entry = codec.find(zip, '/xl/styles.xml');
  if (!entry) throw new Error('Missing generated workbook styles');
  let xml = Buffer.from(entry.content).toString('utf8');
  const xfs = xml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!xfs) throw new Error('Missing generated cell formats');
  const numberFormats = Array.from(
    xfs[2].matchAll(/<xf\b[^>]*numFmtId="(\d+)"[^>]*\/?>/g),
    (match) => Number(match[1]),
  );
  const fontColors: Record<Tone, string> = {
    body: '223553',
    muted: '64748B',
    bold: '223553',
    white: 'FFFFFF',
    title: '172E52',
    green: '176B54',
    red: 'B52F40',
    gray: '5D6879',
    blue: '2458D5',
    amber: '8B5E17',
  };
  const tones = Object.keys(fontColors) as Tone[];
  const fonts = appendStyles(
    xml,
    'fonts',
    tones.map(
      (tone) =>
        '<font><sz val="' +
        (tone === 'title' ? 16 : 10) +
        '"/><color rgb="FF' +
        fontColors[tone] +
        '"/><name val="Arial"/><family val="2"/>' +
        (['body', 'muted'].includes(tone) ? '' : '<b/>') +
        '</font>',
    ),
  );
  xml = fonts.xml;
  const fillColors: Record<Fill, string> = {
    plain: 'FFFFFF',
    stripe: 'F5F8FC',
    navy: '20365C',
    blue: 'EDF3FF',
    green: 'E7F4EF',
    red: 'FDEEEF',
    gray: 'EFF1F5',
    amber: 'FFF5E5',
  };
  const fills = Object.keys(fillColors) as Fill[];
  const backgrounds = appendStyles(
    xml,
    'fills',
    fills.map(
      (fill) =>
        '<fill><patternFill patternType="solid"><fgColor rgb="FF' +
        fillColors[fill] +
        '"/><bgColor indexed="64"/></patternFill></fill>',
    ),
  );
  xml = backgrounds.xml;
  const borders = appendStyles(xml, 'borders', [
    '<border><left/><right/><top/><bottom/></border>',
    '<border><left/><right/><top/><bottom style="hair"><color rgb="FFE0E7F1"/></bottom></border>',
    '<border><left/><right style="thin"><color rgb="FFFFFFFF"/></right><top/><bottom/></border>',
  ]);
  xml = borders.xml;
  const additions: string[] = [];
  const cache = new Map<string, number>();
  const style = (base: number, look: CellAppearance): number => {
    const format = numberFormats[base];
    if (format === undefined)
      throw new Error('Unknown generated number format');
    const key = JSON.stringify([format, look]);
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    const id = Number(xfs[1]) + additions.length;
    additions.push(
      '<xf numFmtId="' +
        format +
        '" fontId="' +
        (fonts.start + tones.indexOf(look.tone)) +
        '" fillId="' +
        (backgrounds.start + fills.indexOf(look.fill)) +
        '" borderId="' +
        (borders.start + look.border) +
        '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">' +
        '<alignment horizontal="' +
        look.align +
        '" vertical="center" wrapText="1"' +
        (look.align === 'center' ? '' : ' indent="1"') +
        '/></xf>',
    );
    cache.set(key, id);
    return id;
  };
  layouts.forEach((layout, index) => {
    const path = '/xl/worksheets/sheet' + (index + 1) + '.xml';
    const sheet = codec.find(zip, path);
    if (!sheet) throw new Error('Missing generated worksheet');
    let content = Buffer.from(sheet.content).toString('utf8');
    const { freezeRows, freezeColumns } = layout;
    const topLeft = XLSX.utils.encode_cell({ r: freezeRows, c: freezeColumns });
    const pane = freezeRows
      ? '<pane xSplit="' +
        freezeColumns +
        '" ySplit="' +
        freezeRows +
        '" topLeftCell="' +
        topLeft +
        '" activePane="bottomRight" state="frozen"/>' +
        '<selection pane="topRight" activeCell="' +
        XLSX.utils.encode_cell({ r: 0, c: freezeColumns }) +
        '" sqref="' +
        XLSX.utils.encode_cell({ r: 0, c: freezeColumns }) +
        '"/>' +
        '<selection pane="bottomLeft" activeCell="A' +
        (freezeRows + 1) +
        '" sqref="A' +
        (freezeRows + 1) +
        '"/>' +
        '<selection pane="bottomRight" activeCell="' +
        topLeft +
        '" sqref="' +
        topLeft +
        '"/>'
      : '<selection activeCell="A1" sqref="A1"/>';
    content = content.replace(
      /<sheetViews>[\s\S]*?<\/sheetViews>/,
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0">' +
        pane +
        '</sheetView></sheetViews>',
    );
    content = content.replace(
      /<row\b([^>]*)>([\s\S]*?)<\/row>/g,
      (_match: string, attributes: string, cells: string) => {
        const rowNumber = Number(attributes.match(/\br="(\d+)"/)?.[1]);
        const row = rowNumber - 1;
        if (!layout.kinds[row])
          throw new Error('Unexpected generated worksheet row');
        if (layout.kinds[row] === 'spacer')
          return '<row' + attributes + '>' + cells + '</row>';
        const existing = new Map<number, string>();
        for (const cell of cells.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
          const reference = cell[0].match(/\br="([A-Z]+\d+)"/)?.[1];
          if (!reference) throw new Error('Missing generated cell reference');
          existing.set(XLSX.utils.decode_cell(reference).c, cell[0]);
        }
        const output = layout.widths
          .map((_width, column) => {
            const cell = existing.get(column);
            const base = Number(cell?.match(/\bs="(\d+)"/)?.[1] ?? 0);
            const id = style(base, appearance(layout, row, column));
            const reference = XLSX.utils.encode_cell({ r: row, c: column });
            if (!cell) return '<c r="' + reference + '" s="' + id + '"/>';
            return cell.replace(
              /^<c\b([^>]*?)(\/?)>/,
              (_tag: string, attrs: string, slash: string) =>
                '<c' +
                attrs.replace(/\s+s="\d+"/, '') +
                ' s="' +
                id +
                '"' +
                slash +
                '>',
            );
          })
          .join('');
        return '<row' + attributes + '>' + output + '</row>';
      },
    );
    codec.utils.cfb_add(zip, path, Buffer.from(content));
  });
  xml = xml.replace(
    xfs[0],
    '<cellXfs count="' +
      (Number(xfs[1]) + additions.length) +
      '">' +
      xfs[2] +
      additions.join('') +
      '</cellXfs>',
  );
  codec.utils.cfb_add(zip, '/xl/styles.xml', Buffer.from(xml));
  const result = codec.write(zip, {
    type: 'buffer',
    fileType: 'zip',
    compression: true,
  });
  if (!Buffer.isBuffer(result))
    throw new Error('Invalid generated workbook archive');
  return result;
}
