import { ChecklistType } from '@prisma/client';
import { IsIn, IsUUID } from 'class-validator';

export class GetGuestStayInput {}

export class StartStayGuestDraftInput {
  @IsUUID('4', { message: '작성 요청 ID를 확인해 주세요.' })
  requestKey: string;

  @IsIn([ChecklistType.CHECK_IN, ChecklistType.CHECK_OUT], {
    message: '이용객 체크리스트 유형을 확인해 주세요.',
  })
  type: typeof ChecklistType.CHECK_IN | typeof ChecklistType.CHECK_OUT;
}
