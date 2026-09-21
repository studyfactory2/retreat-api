import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
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
import { Role } from '@prisma/client';
import type {} from 'multer';
import {
  CreateStayImportPreviewInput,
  EmptyStayImportQueryInput,
  GetStayImportPreviewInput,
} from '../../libs/dto/stay-import/stay-import.input';
import type { StayImportPreviewDto } from '../../libs/dto/stay-import/stay-import';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminImportUploadCapacityInterceptor } from './admin-import-upload-capacity.interceptor';
import { AdminStayImportsService } from './admin-stay-imports.service';

const importIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_STAY_IMPORT_ID',
      message: '이용 일정 가져오기 ID를 확인해 주세요.',
    }),
});

@Controller('admin/stay-imports')
export class AdminStayImportsController {
  constructor(
    private readonly adminStayImportsService: AdminStayImportsService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Post('preview')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    AdminImportUploadCapacityInterceptor,
    FileInterceptor('file', {
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 1,
        fieldSize: 32 * 1024,
        parts: 3,
      },
    }),
  )
  public async preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() input: CreateStayImportPreviewInput,
    @Query() query: EmptyStayImportQueryInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<StayImportPreviewDto> {
    void query;
    console.log('POST: previewStayImport');
    return await this.adminStayImportsService.preview(file, input, actor);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard, ThrottlerGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  public async getPreview(
    @Param('id', importIdPipe) id: string,
    @Query() input: GetStayImportPreviewInput,
  ): Promise<StayImportPreviewDto> {
    console.log('GET: getStayImportPreview');
    return await this.adminStayImportsService.getPreview(id, input);
  }
}
