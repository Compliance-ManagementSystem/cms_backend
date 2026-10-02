/**
 * Document Routes
 *
 * Exposes document upload, download, inline preview, version replacement,
 * and verification status updates.
 */

import { Router } from 'express';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';
import { uploadDocumentFile } from '../middlewares/upload.middleware.js';
import {
  uploadDocument,
  replaceDocument,
  getDocumentById,
  downloadDocument,
  previewDocument,
  verifyDocument,
  deleteDocument,
} from '../controllers/document.controller.js';

const router = Router();

router.use(authenticate);

// Permission checks run before multer so unauthorized uploads never reach disk
router.post('/upload', requirePermission(PERMISSIONS.DOCUMENT_UPLOAD), uploadDocumentFile, uploadDocument);
router.post('/:id/replace', requirePermission(PERMISSIONS.DOCUMENT_UPLOAD), uploadDocumentFile, replaceDocument);
router.get('/:id', requirePermission(PERMISSIONS.DOCUMENT_READ), getDocumentById);
router.get('/:id/download', requirePermission(PERMISSIONS.DOCUMENT_DOWNLOAD), downloadDocument);
router.get('/:id/preview', requirePermission(PERMISSIONS.DOCUMENT_READ), previewDocument);
router.patch('/:id/verify', requirePermission(PERMISSIONS.DOCUMENT_UPDATE), verifyDocument);
router.delete('/:id', requirePermission(PERMISSIONS.DOCUMENT_DELETE), deleteDocument);

export default router;
