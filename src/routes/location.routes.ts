/**
 * Location Routes
 *
 * REST endpoints for Location Management with RBAC and permission protection.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  getLocations,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
} from '../controllers/location.controller.js';
import {
  createLocationSchema,
  updateLocationSchema,
  locationQuerySchema,
} from '../validations/location.validation.js';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('location:read'), validate(locationQuerySchema, 'query'), getLocations);
router.get('/:id', requirePermission('location:read'), getLocationById);
router.post('/', requirePermission('location:create'), validate(createLocationSchema), createLocation);
router.put('/:id', requirePermission('location:update'), validate(updateLocationSchema), updateLocation);
router.delete('/:id', requirePermission('location:delete'), deleteLocation);

export default router;
