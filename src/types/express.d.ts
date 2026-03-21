// Augment Express Request to include user from JWT
export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        coupleMongoId?: string;
        coupleId?: string;
      };
    }
  }
}
