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
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  CreateAdminIssueCategoryInput,
  GetAdminIssueCategoriesInput,
  UpdateAdminIssueCategoryInput,
} from '../../libs/dto/admin-issue-category/admin-issue-category.input';
import type {
  AdminIssueCategoryDto,
  AdminIssueCategoryListDto,
} from '../../libs/dto/admin-issue-category/admin-issue-category';
import { AuthUser } from '../auth/decorators/auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminIssueCategoriesService } from './admin-issue-categories.service';

const categoryIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_ISSUE_CATEGORY_ID',
      message: '이상사항 분류 ID를 확인해 주세요.',
    }),
});

@Controller('admin/issue-categories')
export class AdminIssueCategoriesController {
  constructor(
    private readonly adminIssueCategoriesService: AdminIssueCategoriesService,
  ) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getCategories(
    @Query() input: GetAdminIssueCategoriesInput,
  ): Promise<AdminIssueCategoryListDto> {
    console.log('GET: getCategories');
    return await this.adminIssueCategoriesService.getCategories(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @Header('Cache-Control', 'no-store')
  public async createCategory(
    @Body() input: CreateAdminIssueCategoryInput,
    @AuthUser('id') adminId: string,
  ): Promise<AdminIssueCategoryDto> {
    console.log('POST: createCategory');
    return await this.adminIssueCategoriesService.createCategory(
      input,
      adminId,
    );
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/update')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async updateCategory(
    @Param('id', categoryIdPipe) id: string,
    @Body() input: UpdateAdminIssueCategoryInput,
    @AuthUser('id') adminId: string,
  ): Promise<AdminIssueCategoryDto> {
    console.log('POST: updateCategory');
    return await this.adminIssueCategoriesService.updateCategory(
      id,
      input,
      adminId,
    );
  }
}
