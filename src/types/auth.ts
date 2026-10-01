/**
 * Authentication & Authorization Types
 */

import type { IUser } from '../models/User.js';
import type { IRole } from '../models/Role.js';
import type { TokenPayload } from '../utils/token.js';

export interface AuthenticatedUser extends Omit<IUser, 'role'> {
  role: IRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      auth?: TokenPayload;
    }
  }
}
