import { Router } from 'express';
import { taskController } from '../controllers/task.controller.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { PERMISSIONS } from '../constants/permissions.js';

const router = Router();

// All task routes require authentication
router.use(authenticate);

// Specific filters (must be before :id)
router.get('/my-tasks', taskController.getMyTasks.bind(taskController));
router.get('/overdue', requirePermission(PERMISSIONS.TASK_READ), taskController.getOverdueTasks.bind(taskController));
router.get('/metrics', taskController.getMetrics.bind(taskController));
router.get(
  '/assignees',
  requirePermission([PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE]),
  taskController.getAssignees.bind(taskController)
);

// List and Create
router.get('/', requirePermission(PERMISSIONS.TASK_READ), taskController.getTasks.bind(taskController));
router.post('/', requirePermission(PERMISSIONS.TASK_CREATE), taskController.createTask.bind(taskController));

// Item operations
router.get('/:id', requirePermission(PERMISSIONS.TASK_READ), taskController.getTaskById.bind(taskController));
router.put('/:id', requirePermission(PERMISSIONS.TASK_UPDATE), taskController.updateTask.bind(taskController));
router.patch('/:id/status', requirePermission(PERMISSIONS.TASK_UPDATE), taskController.updateTaskStatus.bind(taskController));
router.post('/:id/comments', requirePermission(PERMISSIONS.TASK_UPDATE), taskController.addComment.bind(taskController));
router.delete('/:id', requirePermission(PERMISSIONS.TASK_DELETE), taskController.deleteTask.bind(taskController));

export default router;
