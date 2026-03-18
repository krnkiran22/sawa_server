import { Server as SocketIOServer, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '../constants/socketEvents';
import { logger } from '../utils/logger';

/**
 * Register private & group chat socket event handlers.
 * Phase 4: implement actual message persistence and broadcasting.
 */
export const registerChatHandlers = (io: SocketIOServer, socket: Socket): void => {
  // Join a chat room (private or group)
  socket.on(SOCKET_EVENTS.CHAT_JOIN, (data: { chatId: string }) => {
    socket.join(`chat:${data.chatId}`);
    logger.debug(`Socket ${socket.id} joined chat:${data.chatId}`);
  });

  // Leave a chat room
  socket.on(SOCKET_EVENTS.CHAT_LEAVE, (data: { chatId: string }) => {
    socket.leave(`chat:${data.chatId}`);
    logger.debug(`Socket ${socket.id} left chat:${data.chatId}`);
  });

  // Receive message from client — broadcast to room
  socket.on(
    SOCKET_EVENTS.CHAT_MESSAGE,
    (data: { chatId: string; content: string; contentType: string }) => {
      // TODO Phase 4: persist message, then broadcast
      io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.CHAT_MESSAGE, {
        chatId: data.chatId,
        senderId: socket.coupleId,
        content: data.content,
        contentType: data.contentType ?? 'text',
        timestamp: new Date().toISOString(),
      });
    },
  );

  // Typing indicators
  socket.on(SOCKET_EVENTS.CHAT_TYPING, (data: { chatId: string }) => {
    socket.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.CHAT_TYPING, {
      chatId: data.chatId,
      senderId: socket.coupleId,
    });
  });

  socket.on(SOCKET_EVENTS.CHAT_STOP_TYPING, (data: { chatId: string }) => {
    socket.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.CHAT_STOP_TYPING, {
      chatId: data.chatId,
      senderId: socket.coupleId,
    });
  });
};
