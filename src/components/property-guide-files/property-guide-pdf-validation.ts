import { BadRequestException } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { MAX_GUIDE_PDF_BYTES } from '../../storage/guide-pdf-storage.service';

// Parsing runs outside the request event loop with a bounded worker heap and deadline.
const validationWorker = `
const { parentPort, workerData } = require('node:worker_threads');
const { PDFDocument, PDFDict, PDFArray, PDFName, PDFRawStream, PDFString, PDFHexString } = require(workerData.modulePath);
(async () => {
  const pdf = await PDFDocument.load(workerData.bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
  if (pdf.isEncrypted || pdf.getPageCount() < 1 || pdf.getPageCount() > 200) throw new Error('invalid');
  const unsafeKeys = new Set(['JS', 'JavaScript', 'AA', 'EmbeddedFiles', 'EF', 'XFA', 'RichMediaContent', 'RichMediaSettings', 'AcroForm']);
  const unsafeActions = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'Rendition', 'Movie', 'Sound']);
  const unsafeTypes = new Set(['EmbeddedFile', 'Filespec', 'RichMedia', 'Movie', 'Sound', 'Screen', '3D']);
  const seen = new Set();
  const pending = pdf.context.enumerateIndirectObjects().map(entry => entry[1]);
  let count = 0;
  while (pending.length) {
    const object = pending.pop();
    if (seen.has(object)) continue;
    seen.add(object);
    if (++count > 200000) throw new Error('complex');
    const dict = object instanceof PDFRawStream ? object.dict : object;
    if (dict instanceof PDFDict) {
      for (const [key, value] of dict.entries()) {
        const name = key.decodeText();
        if (unsafeKeys.has(name)) throw new Error('active');
        const resolved = pdf.context.lookup(value);
        if ((name === 'S' && resolved instanceof PDFName && unsafeActions.has(resolved.decodeText())) ||
            ((name === 'Type' || name === 'Subtype') && resolved instanceof PDFName && unsafeTypes.has(resolved.decodeText()))) throw new Error('active');
        if (name === 'URI') {
          if (!(resolved instanceof PDFString || resolved instanceof PDFHexString)) throw new Error('active');
          if (!/^(https?:|mailto:)/i.test(resolved.decodeText())) throw new Error('active');
        }
        if (resolved) pending.push(resolved);
      }
    } else if (dict instanceof PDFArray) {
      for (let i = 0; i < dict.size(); i++) pending.push(pdf.context.lookup(dict.get(i)));
    }
  }
  parentPort.postMessage(true);
})().catch(() => parentPort.postMessage(false));
`;

export async function validateGuidePdf(
  file: Express.Multer.File | undefined,
): Promise<{ buffer: Buffer; filename: string }> {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.buffer.length < 10 ||
    file.buffer.length > MAX_GUIDE_PDF_BYTES ||
    !/\.pdf$/i.test(file.originalname) ||
    !['application/pdf', 'application/octet-stream'].includes(file.mimetype) ||
    !/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(
      file.buffer.subarray(0, 12).toString('ascii'),
    ) ||
    !/%%EOF\s*$/.test(
      file.buffer.subarray(-1024).toString('latin1').replaceAll('\u0000', ''),
    )
  )
    throw invalidPdf();
  const valid = await new Promise<boolean>((resolve) => {
    const worker = new Worker(validationWorker, {
      eval: true,
      workerData: {
        modulePath: require.resolve('pdf-lib'),
        bytes: file.buffer,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 96,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), 8000);
    worker.once('message', (result: unknown) => finish(result === true));
    worker.once('error', () => finish(false));
    worker.once('exit', () => finish(false));
  });
  if (!valid) throw invalidPdf();
  return { buffer: file.buffer, filename: safePdfFilename(file.originalname) };
}

function invalidPdf(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_GUIDE_PDF',
    message:
      '암호나 첨부 파일이 없는 PDF를 선택해 주세요. 최대 10MB, 200쪽까지 사용할 수 있습니다.',
  });
}

export function safePdfFilename(value: string): string {
  // Multipart filenames may arrive as UTF-8 bytes decoded as Latin-1 by Multer.
  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  const name =
    !decoded.includes('\ufffd') &&
    [...value].every((character) => character.charCodeAt(0) <= 255)
      ? decoded
      : value;
  const basename = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = [...basename.normalize('NFC')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (
        code >= 32 &&
        !(code >= 127 && code <= 159) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      );
    })
    .join('')
    .replace(/[<>:"|?*]/g, '')
    .trim();
  const stem = [...cleaned.replace(/\.pdf$/i, '')]
    .slice(0, 100)
    .join('')
    .trim();
  return (stem && stem !== '.' && stem !== '..' ? stem : '이용 안내') + '.pdf';
}
