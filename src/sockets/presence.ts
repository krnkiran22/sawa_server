import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger';

/**
 * Is this user holding a live socket in their couple room right now?
 * Cluster-correct: fetchSockets() goes through the Redis adapter and sees
 * every PM2 worker; RemoteSocket exposes only `data`, hence the handshake
 * mirror in sockets/index.ts. Fails OPEN (reports offline): for someone
 * actively waiting on a game, a redundant buzz beats silence.
 *
 * Lifted out of us.socket.ts (2026-08-31) so the Nudge Layer can read
 * presence without importing the socket handlers (which import push, which
 * imports the nudge outbox: a cycle otherwise).
 */
export async function isUserOnline(
  io: SocketIOServer,
  coupleId: string,
  targetUserId: string,
): Promise<boolean> {
  try {
    const sockets = await io.in(`couple:${coupleId}`).fetchSockets();
    return sockets.some((s) => s.data?.userId === targetUserId);
  } catch (err: any) {
    logger.warn(`[Presence] check failed (assuming offline): ${err.message}`);
    return false;
  }
}

/** Same check through the process-global io handle (services have no io in scope). */
export async function isUserOnlineGlobal(coupleId: string, userId: string): Promise<boolean> {
  const io = (global as any).io as SocketIOServer | undefined;
  if (!io) return false;
  return isUserOnline(io, coupleId, userId);
}
