import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';

export const healthCheck = asyncHandler(async (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState;
  const dbStateMap: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  // Count registered Mongoose models
  const registeredModels = Object.keys(mongoose.models).sort();

  const response = ApiResponse.ok('Compliance Management System API is running', {
    environment: process.env.NODE_ENV,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStateMap[dbState] ?? 'unknown',
      host: mongoose.connection.host ?? null,
      name: mongoose.connection.name ?? null,
      modelsRegistered: registeredModels.length,
      models: registeredModels,
    },
  });

  res.status(response.statusCode).json(response);
});
