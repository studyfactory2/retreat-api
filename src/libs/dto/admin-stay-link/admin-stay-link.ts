export interface AdminStayLinkStatusDto {
  stayId: string;
  issued: boolean;
  enabled: boolean;
  version: number;
  stayRevision: number;
  issuedForRevision: number | null;
  expiresAt: Date | null;
  updatedAt: Date | null;
}

export interface IssueStayGuestLinkDto extends AdminStayLinkStatusDto {
  url: string;
}
