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
  AssignStaffInput,
  CreatePropertyInput,
  GetPropertiesInput,
  UpdatePropertyInput,
} from '../../libs/dto/property/property.input';
import type {
  PropertyDto,
  PropertyListDto,
} from '../../libs/dto/property/property';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PropertiesService } from './properties.service';

const propertyIdPipe = new ParseUUIDPipe({
  version: '4',
  exceptionFactory: () =>
    new BadRequestException({
      code: 'INVALID_PROPERTY_ID',
      message: '휴양소 ID를 확인해 주세요.',
    }),
});

@Controller('admin/properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @Header('Cache-Control', 'no-store')
  public async createProperty(
    @Body() input: CreatePropertyInput,
  ): Promise<PropertyDto> {
    console.log('POST: createProperty');
    return await this.propertiesService.createProperty(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get()
  @Header('Cache-Control', 'no-store')
  public async getProperties(
    @Query() input: GetPropertiesInput,
  ): Promise<PropertyListDto> {
    console.log('GET: getProperties');
    return await this.propertiesService.getProperties(input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  public async getProperty(
    @Param('id', propertyIdPipe) id: string,
  ): Promise<PropertyDto> {
    console.log('GET: getProperty');
    return await this.propertiesService.getProperty(id);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/update')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async updateProperty(
    @Param('id', propertyIdPipe) id: string,
    @Body() input: UpdatePropertyInput,
  ): Promise<PropertyDto> {
    console.log('POST: updateProperty');
    return await this.propertiesService.updateProperty(id, input);
  }

  @Roles(Role.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/staff')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  public async assignStaff(
    @Param('id', propertyIdPipe) id: string,
    @Body() input: AssignStaffInput,
  ): Promise<PropertyDto> {
    console.log('POST: assignStaff');
    return await this.propertiesService.assignStaff(id, input);
  }
}
