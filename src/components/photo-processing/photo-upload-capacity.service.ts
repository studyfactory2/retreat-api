import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

@Injectable()
export class PhotoUploadCapacityService {
  private activeUploads = 0;

  public acquire(): () => void {
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
    return (): void => {
      if (!released) {
        this.activeUploads -= 1;
        released = true;
      }
    };
  }
}
