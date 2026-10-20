export interface AdminAccountDto {
  id: string;
  name: string;
  loginId: string;
  role: 'ADMIN';
  phone: string | null;
  company: string | null;
  department: string | null;
  updatedAt: Date;
}

export interface PasswordChangedDto {
  passwordChanged: true;
}
