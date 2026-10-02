/**
 * Licence Routes
 *
 * Licences are listed with their location (GET /api/locations/:id); these
 * endpoints add, change and remove them.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { uploadDocumentFile } from '../middlewares/upload.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { createLicence, updateLicence, deleteLicence } from '../controllers/licence.controller.js';

const router = Router();

router.use(authenticate);

// Permission checks run before multer so unauthorized uploads never reach disk
router.post('/', requirePermission(PERMISSIONS.LICENCE_CREATE), uploadDocumentFile, createLicence);
router.put(
  '/:id',
  requirePermission([PERMISSIONS.LICENCE_UPDATE, PERMISSIONS.LICENCE_RENEW]),
  uploadDocumentFile,
  updateLicence
);
router.delete('/:id', requirePermission(PERMISSIONS.LICENCE_DELETE), deleteLicence);

export default router;
