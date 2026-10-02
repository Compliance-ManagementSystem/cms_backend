/**
 * Request Validation Middleware using Zod
 *
 * Two schema styles are supported:
 *   - Wrapped: z.object({ body: ..., query: ..., params: ... }) — validates the whole request
 *   - Flat:    z.object({ name: ..., ... }) — validates one part of the request,
 *              the body by default or the part named in `source`
 */

import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ApiError } from '../utils/apiError.js';

type RequestPart = 'body' | 'query' | 'params';

const REQUEST_PARTS: RequestPart[] = ['body', 'query', 'params'];

export const validate = (schema: AnyZodObject, source?: RequestPart) => {
  const isWrapped = !source && REQUEST_PARTS.some((part) => part in schema.shape);

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (isWrapped) {
        await schema.parseAsync({
          body: req.body,
          query: req.query,
          params: req.params,
        });
      } else {
        await schema.parseAsync(req[source ?? 'body']);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const message = error.errors
          .map((e) => {
            const field = e.path.filter((p) => !REQUEST_PARTS.includes(p as RequestPart)).join('.');
            return field && e.message === 'Required' ? `${field} is required` : e.message;
          })
          .join(', ');
        return next(ApiError.badRequest(message, error.format()));
      }
      next(error);
    }
  };
};
