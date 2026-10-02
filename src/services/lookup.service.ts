/**
 * Lookup Service
 *
 * Read-only reference data for forms and filters, available to every signed-in
 * user. The administration endpoints that manage this data stay admin-only.
 */

import { Types } from 'mongoose';
import MasterData from '../models/MasterData.js';
import User from '../models/User.js';
import type { AccessScope } from '../utils/accessScope.js';

export class LookupService {
  /** Active master data items of one category, in display order */
  public static async getMasterData(category: string, parent?: string) {
    const filter: Record<string, any> = { category, status: 'active' };
    if (parent && Types.ObjectId.isValid(parent)) {
      filter.parent = new Types.ObjectId(parent);
    }

    return MasterData.find(filter)
      .select('category code label description parent sortOrder status')
      .populate('parent', 'code label category')
      .sort({ sortOrder: 1, label: 1 })
      .lean();
  }

  /**
   * Active users that work can be assigned to, limited to the caller's scope:
   * users of the entity plus org-wide staff who are not tied to one entity.
   */
  public static async getAssignableUsers(scope: AccessScope, callerId: string, requestedEntity?: string) {
    const entityId = scope.unrestricted
      ? requestedEntity && Types.ObjectId.isValid(requestedEntity)
        ? requestedEntity
        : undefined
      : scope.entityId;

    const filter: Record<string, any> = { status: 'active' };
    if (entityId) {
      filter.$or = [{ entity: new Types.ObjectId(entityId) }, { entity: null }];
    } else if (!scope.unrestricted) {
      filter._id = new Types.ObjectId(callerId);
    }

    return User.find(filter)
      .select('firstName lastName email role entity')
      .populate('role', 'name code')
      .sort({ firstName: 1, lastName: 1 })
      .limit(200);
  }
}
