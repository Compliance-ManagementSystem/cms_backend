import cron, { ScheduledTask } from 'node-cron';
import { taskAutomationService } from './taskAutomation.service.js';

class SchedulerService {
  private dailyTaskCron: ScheduledTask | null = null;
  private isRunning: boolean = false;

  /**
   * Initialize cron jobs
   * Default daily run at 00:00 (midnight)
   */
  public initScheduler(cronExpression = '0 0 * * *'): void {
    if (this.dailyTaskCron) {
      console.log('⚠️ [Scheduler] Cron scheduler is already running.');
      return;
    }

    console.log(`⏰ [Scheduler] Initializing compliance automation scheduler (${cronExpression})...`);

    this.dailyTaskCron = cron.schedule(cronExpression, async () => {
      console.log(`\n⏰ [Scheduler] Running daily scheduled compliance automation job...`);
      await this.runComplianceChecks();
    });

    console.log('✅ [Scheduler] Compliance automation scheduler started successfully.');
  }

  /**
   * Programmatic / on-demand trigger of compliance checks
   */
  public async runComplianceChecks(): Promise<{
    tasksCreated: number;
    notificationsSent: number;
    summary: Record<string, number>;
  }> {
    if (this.isRunning) {
      console.log('⚠️ [Scheduler] Compliance checks already in progress, skipping concurrent run.');
      return { tasksCreated: 0, notificationsSent: 0, summary: {} };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const result = await taskAutomationService.generateComplianceTasks();
      const elapsed = Date.now() - startTime;
      console.log(
        `✅ [Scheduler] Compliance check completed in ${elapsed}ms: ` +
        `${result.tasksCreated} tasks created, ${result.notificationsSent} notifications sent.`
      );
      return result;
    } catch (error) {
      console.error('❌ [Scheduler] Error during scheduled compliance checks:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop scheduled jobs (graceful shutdown)
   */
  public stopScheduler(): void {
    if (this.dailyTaskCron) {
      this.dailyTaskCron.stop();
      this.dailyTaskCron = null;
      console.log('🛑 [Scheduler] Compliance automation scheduler stopped.');
    }
  }
}

export const schedulerService = new SchedulerService();
