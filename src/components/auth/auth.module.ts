import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { RuntimeEnvironment } from '../../config/environment';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { WithoutGuard } from './guards/without.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService<RuntimeEnvironment, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          issuer: 'retreat-api',
          audience: 'retreat-admin',
          expiresIn: '7d',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'retreat-api',
          audience: 'retreat-admin',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, AuthGuard, RolesGuard, WithoutGuard],
  exports: [AuthService, AuthGuard, RolesGuard, WithoutGuard],
})
export class AuthModule {}
