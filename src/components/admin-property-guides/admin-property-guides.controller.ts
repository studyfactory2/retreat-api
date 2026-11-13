import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  type StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {} from 'multer';
import { MAX_GUIDE_PDF_BYTES } from '../../storage/guide-pdf-storage.service';
import { GuidePdfUploadCapacityInterceptor } from './guide-pdf-upload-capacity.interceptor';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import {
  GetAdminPropertyGuideInput,
  GetPropertyGuidePdfInput,
  SaveAdminPropertyGuidePdfInput,
  SaveAdminPropertyGuideInput,
} from '../../libs/dto/admin-property-guide/admin-property-guide.input';
import type { AdminPropertyGuideDto } from '../../libs/dto/admin-property-guide/admin-property-guide';
import type { AuthenticatedUser } from '../../libs/dto/user/user';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminPropertyGuidesService } from './admin-property-guides.service';

const propertyIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PROPERTY_ID',
      message: '휴양소 ID를 확인해 주세요.',
    }),
});

@Controller('admin/properties/:id/guide')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class AdminPropertyGuidesController {
  constructor(
    private readonly adminPropertyGuidesService: AdminPropertyGuidesService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  public async getGuide(
    @Param('id', propertyIdPipe) id: string,
    @Query() input: GetAdminPropertyGuideInput,
  ): Promise<AdminPropertyGuideDto> {
    void input;
    console.log('GET: getPropertyGuide');
    return await this.adminPropertyGuidesService.getGuide(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async saveGuide(
    @Param('id', propertyIdPipe) id: string,
    @Query() query: GetAdminPropertyGuideInput,
    @Body() input: SaveAdminPropertyGuideInput,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<AdminPropertyGuideDto> {
    void query;
    console.log('POST: savePropertyGuide');
    return await this.adminPropertyGuidesService.saveGuide(id, input, actor.id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get('pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Access-Control-Expose-Headers', 'Content-Disposition')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  public async getPdf(
    @Param('id', propertyIdPipe) id: string,
    @Query() input: GetPropertyGuidePdfInput,
  ): Promise<StreamableFile> {
    console.log('GET: getPropertyGuidePdf');
    return await this.adminPropertyGuidesService.getPdf(id, input.version);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post('pdf')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    GuidePdfUploadCapacityInterceptor,
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_GUIDE_PDF_BYTES,
        files: 1,
        fields: 4,
        fieldSize: 100_000,
        parts: 6,
      },
    }),
  )
  public async savePdf(
    @Param('id', propertyIdPipe) id: string,
    @Query() query: GetAdminPropertyGuideInput,
    @Body() input: SaveAdminPropertyGuidePdfInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @AuthUser() actor: AuthenticatedUser,
  ): Promise<AdminPropertyGuideDto> {
    void query;
    console.log('POST: savePropertyGuidePdf');
    return await this.adminPropertyGuidesService.savePdf(
      id,
      input,
      actor.id,
      file,
    );
  }
}
