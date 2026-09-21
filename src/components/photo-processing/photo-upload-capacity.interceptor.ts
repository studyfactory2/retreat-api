import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';
import { PhotoUploadCapacityService } from './photo-upload-capacity.service';

@Injectable()
export class PhotoUploadCapacityInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  constructor(private readonly capacity: PhotoUploadCapacityService) {}

  public intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const release = this.capacity.acquire();

    try {
      return next.handle().pipe(finalize(release));
    } catch (error) {
      release();
      throw error;
    }
  }
}
