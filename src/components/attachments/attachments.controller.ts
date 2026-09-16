import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {} from 'multer';
import { PhotoInput } from '../../libs/dto/attachment/attachment.input';
import type {
  DraftPhotoDto,
  DraftPhotoListDto,
  DraftPhotoViewDto,
  RemovedDraftPhotoDto,
} from '../../libs/dto/attachment/attachment';
import { AttachmentsService } from './attachments.service';
import { DraftPhotoAccessGuard } from './draft-photo-access.guard';
import { MAX_PHOTO_BYTES } from './photo-policy';
import { PhotoUploadCapacityInterceptor } from './photo-upload-capacity.interceptor';

const photoIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PHOTO_ID',
      message: '사진 ID를 확인해 주세요.',
    }),
});

@Controller('submission-drafts/photos')
@UseGuards(ThrottlerGuard, DraftPhotoAccessGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    PhotoUploadCapacityInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  public async uploadPhoto(
    @Headers('authorization') authorization: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() input: PhotoInput,
  ): Promise<DraftPhotoDto> {
    void input;
    console.log('POST: uploadPhoto');
    return await this.attachmentsService.uploadPhoto(authorization, file);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  public async listPhotos(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<DraftPhotoListDto> {
    console.log('GET: listPhotos');
    return await this.attachmentsService.listPhotos(authorization);
  }

  @Get(':id/view')
  @Header('Cache-Control', 'no-store')
  public async getPhotoView(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', photoIdPipe) id: string,
  ): Promise<DraftPhotoViewDto> {
    console.log('GET: getPhotoView');
    return await this.attachmentsService.getPhotoView(authorization, id);
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async removePhoto(
    @Headers('authorization') authorization: string | undefined,
    @Param('id', photoIdPipe) id: string,
    @Body() input: PhotoInput,
  ): Promise<RemovedDraftPhotoDto> {
    void input;
    console.log('POST: removePhoto');
    return await this.attachmentsService.removePhoto(authorization, id);
  }
}
