import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';

/**
 * Register match notification socket handlers.
 * Phase 3: emit MATCH_NEW and MATCH_ACCEPTED to specific couple rooms.
 */
export const registerMatchHandlers = (_io: SocketIOServer, socket: Socket): void => {
  // Each couple joins their own room for targeted notifications
  if (socket.entityId) {
    socket.join(`couple:${socket.entityId}`);
    logger.debug(`Socket ${socket.id} joined couple room: couple:${socket.entityId}`);
  }

  // TODO Phase 3: emit match:new from matchService when a new suggestion is created
  // TODO Phase 3: emit match:accepted when a match is mutually accepted
};

/**
 * Helper: emit a new match event to a specific couple.
 * Call this from the match service when a match is created.
 */
export const emitNewMatch = (io: SocketIOServer, coupleId: string, matchData: unknown): void => {
  io.to(`couple:${coupleId}`).emit('match:new', matchData);
};

/**
 * Helper: emit match accepted event to both couples.
 */
export const emitMatchAccepted = (
  io: SocketIOServer,
  couple1Id: string,
  couple2Id: string,
  matchData: unknown,
): void => {
  io.to(`couple:${couple1Id}`).emit('match:accepted', matchData);
  io.to(`couple:${couple2Id}`).emit('match:accepted', matchData);
};
