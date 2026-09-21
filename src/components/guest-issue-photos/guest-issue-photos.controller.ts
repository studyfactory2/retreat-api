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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type {} from 'multer';
import { GuestIssuePhotoInput } from '../../libs/dto/guest-issue-photo/guest-issue-photo.input';
import type {
  GuestIssuePhotoUploadDto,
  GuestIssuePhotoViewDto,
  RemovedGuestIssuePhotoDto,
} from '../../libs/dto/guest-issue-photo/guest-issue-photo';
import { MAX_PHOTO_BYTES } from '../photo-processing/photo-policy';
import { PhotoUploadCapacityInterceptor } from '../photo-processing/photo-upload-capacity.interceptor';
import { GuestIssuePhotoAccessGuard } from '../auth/guards/guest-issue-photo-access.guard';
import { GuestIssuePhotosService } from './guest-issue-photos.service';

const photoIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PHOTO_ID',
      message: '사진 ID를 확인해 주세요.',
    }),
});

@Controller('guest/issues/photos')
@UseGuards(ThrottlerGuard, GuestIssuePhotoAccessGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class GuestIssuePhotosController {
  constructor(
    private readonly guestIssuePhotosService: GuestIssuePhotosService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    PhotoUploadCapacityInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  public async uploadPhoto(
    @Headers('authorization') authorization: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() input: GuestIssuePhotoInput,
    @Query() query: GuestIssuePhotoInput,
  ): Promise<GuestIssuePhotoUploadDto> {
    void input;
    void query;
    console.log('POST: uploadGuestIssuePhoto');
    return await this.guestIssuePhotosService.uploadPhoto(authorization, file);
  }

  @Get(':id/view')
  @Header('Cache-Control', 'no-store')
  public async getPhotoView(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-photo-token') token: string | undefined,
    @Param('id', photoIdPipe) id: string,
    @Query() input: GuestIssuePhotoInput,
  ): Promise<GuestIssuePhotoViewDto> {
    void input;
    console.log('GET: getGuestIssuePhotoView');
    return await this.guestIssuePhotosService.getPhotoView(
      authorization,
      id,
      token,
    );
  }

  @Post(':id/remove')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async removePhoto(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-photo-token') token: string | undefined,
    @Param('id', photoIdPipe) id: string,
    @Body() input: GuestIssuePhotoInput,
    @Query() query: GuestIssuePhotoInput,
  ): Promise<RemovedGuestIssuePhotoDto> {
    void input;
    void query;
    console.log('POST: removeGuestIssuePhoto');
    return await this.guestIssuePhotosService.removePhoto(
      authorization,
      id,
      token,
    );
  }
}
