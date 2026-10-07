export interface GuestIssueCategoryListDto {
  items: Array<{ id: string; name: string }>;
}

export interface GuestIssueReceiptDto {
  issueId: string;
  status: 'RECEIVED';
  isUrgent: boolean;
  property: { id: string; name: string };
  receivedAt: Date;
}
