export interface GuestIssueCategoryListDto {
  items: Array<{ id: string; name: string }>;
}

export interface GuestIssueReceiptDto {
  issueId: string;
  status: 'RECEIVED';
  property: { id: string; name: string };
  receivedAt: Date;
}
