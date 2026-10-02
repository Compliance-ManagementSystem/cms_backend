import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { taskAutomationService } from '../services/taskAutomation.service.js';
import { auditService } from '../services/audit.service.js';
import ComplianceRecord from '../models/ComplianceRecord.js';
import User from '../models/User.js';
import type { ITask } from '../models/Task.js';
import { ApiError } from '../utils/apiError.js';
import { assertInScope, getAccessScope, isInScope, toScopeFilter } from '../utils/accessScope.js';
import {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  addTaskCommentSchema,
  taskQuerySchema,
} from '../validations/task.validation.js';

/**
 * Tasks a user may see: everything inside their entity / location scope,
 * plus any task assigned to them personally.
 */
const taskScopeFilter = (req: Request): Record<string, any> => {
  const scope = getAccessScope(req);
  if (scope.unrestricted) return {};
  return {
    $or: [toScopeFilter(scope), { assignedTo: new Types.ObjectId(req.auth!.userId) }],
  };
};

const assertTaskAccess = (req: Request, task: ITask): void => {
  const assignee = task.assignedTo as any;
  const assigneeId = (assignee?._id ?? assignee)?.toString();
  if (assigneeId === req.auth?.userId) return;
  if (isInScope(getAccessScope(req), task)) return;
  throw ApiError.forbidden('You are not authorized to access tasks outside your assigned entity or location.');
};

export class TaskController {
  /**
   * GET /api/tasks
   * List tasks with filters, search, pagination
   */
  public async getTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = taskQuerySchema.parse(req.query);

      const result = await taskAutomationService.getTasks(
        { ...query, overdueOnly: query.overdueOnly === 'true' },
        taskScopeFilter(req)
      );

      res.status(200).json({
        success: true,
        data: result.tasks,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tasks/my-tasks
   * List tasks assigned to the authenticated user
   */
  public async getMyTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = taskQuerySchema.parse(req.query);

      const result = await taskAutomationService.getTasks({
        ...query,
        overdueOnly: query.overdueOnly === 'true',
        assignedTo: req.auth!.userId,
      });

      res.status(200).json({
        success: true,
        data: result.tasks,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tasks/overdue
   * List tasks currently overdue
   */
  public async getOverdueTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = taskQuerySchema.parse(req.query);

      const result = await taskAutomationService.getTasks(
        { ...query, overdueOnly: true },
        taskScopeFilter(req)
      );

      res.status(200).json({
        success: true,
        data: result.tasks,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tasks/metrics
   * Quick status counters for dashboard / task views
   */
  public async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const myOnly = req.query.myOnly === 'true';
      const metrics = await taskAutomationService.getTaskMetrics(
        myOnly ? {} : taskScopeFilter(req),
        myOnly ? req.auth!.userId : undefined
      );
      res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tasks/assignees
   * Users a task can be assigned to, limited to the caller's scope.
   * Available to anyone who can create or update tasks (not only administrators).
   */
  public async getAssignees(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const scope = getAccessScope(req);
      const requestedEntity =
        typeof req.query.entity === 'string' && Types.ObjectId.isValid(req.query.entity)
          ? req.query.entity
          : undefined;
      const entityId = scope.unrestricted ? requestedEntity : scope.entityId;

      const filter: Record<string, any> = { status: 'active' };
      if (entityId) {
        // Users of the entity plus org-wide staff who are not tied to one entity
        filter.$or = [{ entity: new Types.ObjectId(entityId) }, { entity: null }];
      } else if (!scope.unrestricted) {
        filter._id = new Types.ObjectId(req.auth!.userId);
      }

      const users = await User.find(filter)
        .select('firstName lastName email role entity')
        .populate('role', 'name code')
        .sort({ firstName: 1, lastName: 1 })
        .limit(200);

      res.status(200).json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tasks/:id
   */
  public async getTaskById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const task = await taskAutomationService.getTaskById(String(req.params.id));
      assertTaskAccess(req, task);
      res.status(200).json({
        success: true,
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/tasks
   */
  public async createTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createTaskSchema.parse(req.body);

      let entity = input.entity;
      let location = input.location;

      // A task linked to a compliance record belongs to that record's entity & location
      if (input.complianceRecord) {
        const record = await ComplianceRecord.findById(input.complianceRecord).select('entity location');
        if (!record) throw ApiError.notFound('Linked compliance record not found.');
        entity = String(record.entity);
        location = String(record.location);
      }

      if (!entity) {
        throw ApiError.badRequest('Entity is required.');
      }
      assertInScope(req, { entity, location }, 'You cannot create tasks outside your assigned entity or location.');

      const assignee = await User.exists({ _id: input.assignedTo, status: 'active' });
      if (!assignee) {
        throw ApiError.badRequest('Assignee must be an active user.');
      }

      const task = await taskAutomationService.createTask({
        ...input,
        entity,
        location,
        createdBy: req.auth!.userId,
      });

      await auditService.logTaskCreated(task, req);

      res.status(201).json({
        success: true,
        message: 'Task created successfully',
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/tasks/:id
   */
  public async updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = updateTaskSchema.parse(req.body);
      assertTaskAccess(req, await taskAutomationService.getTaskById(String(req.params.id)));

      const task = await taskAutomationService.updateTask(String(req.params.id), input, req.auth!.userId);
      res.status(200).json({
        success: true,
        message: 'Task updated successfully',
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/tasks/:id/status
   */
  public async updateTaskStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status } = updateTaskStatusSchema.parse(req.body);
      assertTaskAccess(req, await taskAutomationService.getTaskById(String(req.params.id)));

      const task = await taskAutomationService.updateTask(String(req.params.id), { status }, req.auth!.userId);

      res.status(200).json({
        success: true,
        message: `Task status updated to ${status}`,
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/tasks/:id/comments
   */
  public async addComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { text } = addTaskCommentSchema.parse(req.body);
      assertTaskAccess(req, await taskAutomationService.getTaskById(String(req.params.id)));

      const task = await taskAutomationService.addComment(String(req.params.id), text, req.auth!.userId);

      res.status(201).json({
        success: true,
        message: 'Comment added',
        data: task,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/tasks/:id
   */
  public async deleteTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const task = await taskAutomationService.getTaskById(String(req.params.id));
      assertTaskAccess(req, task);

      await taskAutomationService.deleteTask(String(req.params.id));

      await auditService.logMutation({
        req,
        action: 'TASK_DELETED',
        module: 'tasks',
        entityType: 'Task',
        recordId: task._id,
        previousValue: { title: task.title, status: task.status, priority: task.priority },
        description: `Deleted task '${task.title}'`,
      });

      res.status(200).json({
        success: true,
        message: 'Task deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}

export const taskController = new TaskController();
