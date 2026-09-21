import {
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';

@Injectable()
export class AdminImportUploadCapacityInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  private active = 0;
  public intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (this.active >= 2)
      throw new HttpException(
        {
          code: 'IMPORT_UPLOAD_BUSY',
          message: '이용자 명단을 처리 중입니다. 잠시 후 다시 시도해 주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    this.active++;
    let released = false;
    const release = (): void => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
    try {
      return next.handle().pipe(finalize(release));
    } catch (error) {
      release();
      throw error;
    }
  }
}
