import http from 'http';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import createApp from './app.js';
import { socketService } from './services/socket.service.js';
import { schedulerService } from './services/scheduler.service.js';

const startServer = async (): Promise<void> => {
  // Connect to MongoDB first
  await connectDB();

  const app = createApp();
  const httpServer = http.createServer(app);

  // Initialize Socket.IO
  socketService.init(httpServer);

  // Start automated cron jobs for compliance checks
  schedulerService.initScheduler();

  const server = httpServer.listen(env.PORT, () => {
    console.log(`🚀 Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
    console.log(`📋 Health check: http://localhost:${env.PORT}/api/health`);
    console.log(`🔌 Socket.IO initialized for real-time notifications & task updates`);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n⚠️  ${signal} received. Shutting down gracefully...`);
    schedulerService.stopScheduler();
    if ('closeAllConnections' in server) {
      (server as any).closeAllConnections();
    }
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // ── Unhandled rejections ───────────────────────────────────────────────────
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Promise Rejection:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
};

startServer();
