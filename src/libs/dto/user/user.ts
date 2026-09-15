import type { Role } from '@prisma/client';
import type { Request } from 'express';

export interface JwtPayload {
  userId: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  role: Role;
  loginId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser | null;
}

export interface LoginResponse {
  user: AuthenticatedUser;
  token: string;
  tokenType: 'Bearer';
  expiresIn: number;
}
