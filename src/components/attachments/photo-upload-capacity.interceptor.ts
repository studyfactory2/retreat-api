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
export class PhotoUploadCapacityInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  private activeUploads = 0;

  public intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (this.activeUploads >= 4) {
      throw new HttpException(
        {
          code: 'PHOTO_UPLOAD_BUSY',
          message: '사진 업로드가 많습니다. 잠시 후 다시 시도해 주세요.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.activeUploads += 1;
    let released = false;
    const release = (): void => {
      if (!released) {
        this.activeUploads -= 1;
        released = true;
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
