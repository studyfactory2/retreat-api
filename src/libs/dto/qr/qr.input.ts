import { IsISO8601, Matches, ValidateIf } from 'class-validator';

const utcTimestampPattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export class RotatePropertyQrInput {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'QR 발급 일시를 확인해 주세요.' },
  )
  @Matches(utcTimestampPattern, {
    message: 'QR 발급 일시는 밀리초가 포함된 UTC 형식 또는 null이어야 합니다.',
  })
  expectedRotatedAt: string | null;
}
