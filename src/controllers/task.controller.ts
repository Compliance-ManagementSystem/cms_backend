import { Request, Response, NextFunction } from 'express';
import { taskAutomationService } from '../services/taskAutomation.service.js';
import { ApiError } from '../utils/apiError.js';
import { TaskStatus, TaskPriority } from '../types/models.js';

export class TaskController {
  /**
   * GET /api/tasks
   * List tasks with filters, search, pagination
   */
  public async getTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page,
        limit,
        search,
        status,
        priority,
        entity,
        location,
        complianceRecord,
        assignedTo,
        overdueOnly,
        sortBy,
        sortOrder,
      } = req.query;

      const result = await taskAutomationService.getTasks({
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        search: search as string,
        status: status as TaskStatus,
        priority: priority as TaskPriority,
        entity: entity as string,
        location: location as string,
        complianceRecord: complianceRecord as string,
        assignedTo: assignedTo as string,
        overdueOnly: overdueOnly === 'true',
        sortBy: sortBy as string,
        sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
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
   * GET /api/tasks/my-tasks
   * List tasks assigned to the authenticated user
   */
  public async getMyTasks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as any).user?._id;
      if (!userId) {
        throw ApiError.unauthorized('Authentication required');
      }

      const { page, limit, status, priority, search } = req.query;

      const result = await taskAutomationService.getTasks({
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        assignedTo: userId.toString(),
        status: status as TaskStatus,
        priority: priority as TaskPriority,
        search: search as string,
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
      const { page, limit, entity, priority, search } = req.query;

      const result = await taskAutomationService.getTasks({
        page: page ? parseInt(page as string, 10) : undefined,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        overdueOnly: true,
        entity: entity as string,
        priority: priority as TaskPriority,
        search: search as string,
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
   * GET /api/tasks/metrics
   * Quick status counters for dashboard / task views
   */
  public async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.query.myOnly === 'true' ? (req as any).user?._id?.toString() : undefined;
      const metrics = await taskAutomationService.getTaskMetrics(userId);
      res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/tasks/:id
   */
  public async getTaskById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const task = await taskAutomationService.getTaskById(req.params.id);
      if (!task) {
        throw ApiError.notFound('Task not found');
      }
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
      const userId = (req as any).user?._id;
      const task = await taskAutomationService.createTask({
        ...req.body,
        createdBy: userId,
      });

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
      const userId = (req as any).user?._id;
      const task = await taskAutomationService.updateTask(req.params.id, req.body, userId);
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
      const userId = (req as any).user?._id;
      const { status } = req.body;
      if (!status) {
        throw ApiError.badRequest('Status is required');
      }

      const task = await taskAutomationService.updateTask(
        req.params.id,
        { status },
        userId
      );

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
   * DELETE /api/tasks/:id
   */
  public async deleteTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await taskAutomationService.deleteTask(req.params.id);
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
