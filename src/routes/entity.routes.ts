/**
 * Entity Routes
 *
 * REST endpoints for Entity Management with RBAC and permission protection.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  getEntities,
  getEntityById,
  createEntity,
  updateEntity,
  deleteEntity,
} from '../controllers/entity.controller.js';
import {
  createEntitySchema,
  updateEntitySchema,
} from '../validations/entity.validation.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('entity:read'), getEntities);
router.get('/:id', requirePermission('entity:read'), getEntityById);
router.post('/', requirePermission('entity:create'), validate(createEntitySchema), createEntity);
router.put('/:id', requirePermission('entity:update'), validate(updateEntitySchema), updateEntity);
router.delete('/:id', requirePermission('entity:delete'), deleteEntity);

export default router;
