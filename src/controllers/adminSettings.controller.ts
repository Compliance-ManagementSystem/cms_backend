/**
 * Admin Settings Controller
 *
 * System-wide configurations, notification channel toggles, advance alert intervals,
 * and compliance SLA thresholds.
 */

import { Request, Response } from 'express';
import Settings from '../models/Settings.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { logAuditEvent } from '../utils/audit.js';

// ── 1. Get Global Settings ──────────────────────────────────────────────────
export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  let settings = await Settings.findOne({ entity: null });

  // If no settings exist yet, initialize default global settings
  if (!settings) {
    settings = await Settings.create({
      entity: null,
      notifications: {
        emailEnabled: true,
        whatsappEnabled: false,
        smsEnabled: false,
        defaultReminderDays: [90, 60, 30, 7],
      },
      workflows: [],
      config: {
        systemName: 'Compliance Management System',
        sessionTimeoutMinutes: 60,
        maxFileUploadSizeMB: 25,
        allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        taskSlaDays: 7,
        escalationGraceDays: 3,
      },
    });
  }

  return ApiResponse.success(res, { settings });
});

// ── 2. Update Global Settings ───────────────────────────────────────────────
export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const { notifications, config, workflows } = req.body;

  let settings = await Settings.findOne({ entity: null });
  if (!settings) {
    settings = new Settings({ entity: null });
  }

  const previousState = {
    notifications: settings.notifications,
    config: settings.config,
    workflowsCount: settings.workflows?.length || 0,
  };

  if (notifications) {
    settings.notifications = {
      ...settings.notifications,
      ...notifications,
    };
  }

  if (config) {
    settings.config = {
      ...settings.config,
      ...config,
    };
  }

  if (workflows !== undefined) {
    settings.workflows = workflows;
  }

  settings.updatedBy = req.user?._id;
  await settings.save();

  await logAuditEvent({
    req,
    action: 'update',
    resource: 'Settings',
    resourceId: settings._id,
    previousValue: previousState,
    newValue: {
      notifications: settings.notifications,
      config: settings.config,
    },
    description: 'Updated global system configuration and notification policies',
  });

  return ApiResponse.success(res, { settings }, 'System settings updated successfully');
});
