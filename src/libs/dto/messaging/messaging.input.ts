import { MessageKind } from '@prisma/client';
import { IsEnum, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class MessagingEmptyInput {}
export class PreviewMessageInput {
  @IsEnum(MessageKind, { message: '안내 종류를 확인해 주세요.' })
  kind: MessageKind;
}
export class SendMessageInput extends PreviewMessageInput {
  @IsUUID('4', { message: '발송 요청 ID를 확인해 주세요.' })
  requestKey: string;

  @IsString()
  @MaxLength(100)
  @Matches(/^\d{13}\.[a-f0-9]{64}$/, {
    message: '메시지를 다시 미리 확인해 주세요.',
  })
  previewKey: string;
}
