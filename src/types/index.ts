// Shared application-level TypeScript types

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
