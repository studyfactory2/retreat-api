export interface ApiFieldError {
  field: string;
  messages: string[];
}

export interface ApiErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  errors?: ApiFieldError[];
  path: string;
  timestamp: string;
}
