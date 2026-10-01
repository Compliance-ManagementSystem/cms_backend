import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/apiError.js';
import { env } from '../config/env.js';

interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  errors: unknown[];
  stack?: string;
  timestamp: string;
}

export const errorMiddleware = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let errors: unknown[] = [];

  console.error('SERVER ERROR CAUGHT IN MIDDLEWARE:', err);

  // Handle known operational errors
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  }
  // Handle Zod validation errors
  else if (err instanceof ZodError) {
    statusCode = 422;
    message = 'Validation Error';
    errors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
  }
  // Handle Mongoose duplicate key error
  else if ((err as NodeJS.ErrnoException).name === 'MongoServerError') {
    statusCode = 409;
    message = 'Duplicate key error';
  }
  // Handle Mongoose CastError
  else if ((err as NodeJS.ErrnoException).name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  } else {
    message = err.message || 'Internal Server Error';
  }

  const response: ErrorResponse = {
    success: false,
    statusCode,
    message,
    errors,
    timestamp: new Date().toISOString(),
  };

  if (env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};
