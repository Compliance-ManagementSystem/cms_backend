import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middlewares/requestLogger.middleware.js';
import { notFoundMiddleware } from './middlewares/notFound.middleware.js';
import { errorMiddleware } from './middlewares/error.middleware.js';
import apiRoutes from './routes/index.js';

// ── Register all Mongoose models ──────────────────────────────────────────────
// Must be imported after DB connection is established (done in server.ts).
// This ensures model names are registered before any query executes.
import './models/index.js';

const createApp = (): Application => {
  const app = express();

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

  // ── Body & Cookie parsers ─────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // ── Request logging ───────────────────────────────────────────────────────
  app.use(requestLogger);

  // ── API Routes ────────────────────────────────────────────────────────────
  app.use('/api', apiRoutes);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use(notFoundMiddleware);

  // ── Global error handler (must be last) ──────────────────────────────────
  app.use(errorMiddleware);

  return app;
};

export default createApp;
