import morgan from 'morgan';
import { env } from '../config/env.js';

// Custom token: timestamp in ISO format
morgan.token('timestamp', () => new Date().toISOString());

const devFormat =
  ':timestamp :method :url :status :response-time ms - :res[content-length]';

const prodFormat =
  ':timestamp :remote-addr :method :url :status :response-time ms';

export const requestLogger = morgan(
  env.NODE_ENV === 'production' ? prodFormat : devFormat
);
