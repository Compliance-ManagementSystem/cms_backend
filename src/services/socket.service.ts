/**
 * Socket.IO Real-time Service
 *
 * Provides real-time websocket broadcasting for:
 * - In-app Notifications
 * - Task Assignments
 * - Approval Status Changes
 * - Compliance Lifecycle Status Changes
 */

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/token.js';
import { env } from '../config/env.js';

let io: SocketIOServer | null = null;

export const initSocket = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      credentials: true,
    },
    pingTimeout: 60000,
  });

  io.use((socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '') ||
        (socket.handshake.query?.token as string);

      if (token) {
        try {
          const decoded = verifyAccessToken(token);
          socket.data.userId = decoded.userId;
        } catch {
          // Allow connection even without token, but don't join private user room
        }
      }
      next();
    } catch (err: any) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data?.userId;

    if (userId) {
      socket.join(`user:${userId}`);
    }

    socket.on('join:entity', (entityId: string) => {
      if (entityId) socket.join(`entity:${entityId}`);
    });

    socket.on('leave:entity', (entityId: string) => {
      if (entityId) socket.leave(`entity:${entityId}`);
    });

    socket.on('disconnect', () => {
      // Clean disconnect
    });
  });

  return io;
};

export const getIO = (): SocketIOServer | null => {
  return io;
};

// ── Real-time Broadcast Helpers ───────────────────────────────────────────────

export const emitToUser = (userId: string, event: string, data: any): void => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

export const emitToEntity = (entityId: string, event: string, data: any): void => {
  if (io) {
    io.to(`entity:${entityId}`).emit(event, data);
  }
};

export const emitToAll = (event: string, data: any): void => {
  if (io) {
    io.emit(event, data);
  }
};

export const emitNotification = (userId: string, notification: any): void => {
  emitToUser(userId, 'notification:new', notification);
};

export const emitTaskAssigned = (userId: string, task: any): void => {
  emitToUser(userId, 'task:assigned', task);
};

export const emitApprovalChanged = (recordId: string, approval: any): void => {
  if (io) {
    io.emit('approval:changed', { recordId, approval });
  }
};

export const emitComplianceStatusChanged = (recordId: string, record: any): void => {
  if (io) {
    io.emit('compliance:status_changed', { recordId, record });
  }
};

export const socketService = {
  init: initSocket,
  getIO,
  emitToUser,
  emitToEntity,
  emitToAll,
  emitNotification,
  emitTaskAssigned,
  emitApprovalChanged,
  emitComplianceStatusChanged,
};

