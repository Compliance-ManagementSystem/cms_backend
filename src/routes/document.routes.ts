/**
 * Document Routes
 *
 * Exposes document upload, download, inline preview, version replacement,
 * and verification status updates.
 */

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
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

// Public/authenticated access
router.use(authenticate);

router.post('/upload', uploadDocumentFile, uploadDocument);
router.post('/:id/replace', uploadDocumentFile, replaceDocument);
router.get('/:id', getDocumentById);
router.get('/:id/download', downloadDocument);
router.get('/:id/preview', previewDocument);
router.patch('/:id/verify', verifyDocument);
router.delete('/:id', deleteDocument);

export default router;
