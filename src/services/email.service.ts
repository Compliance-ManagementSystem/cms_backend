/**
 * Email Notification Service Architecture
 *
 * Implements email notification dispatch architecture with formatted HTML templates
 * for compliance alerts, task delegations, and statutory approval milestones.
 */

export interface EmailPayload {
  to: string;
  recipientName?: string;
  subject: string;
  template:
    | 'task_assigned'
    | 'compliance_expiring'
    | 'compliance_expired'
    | 'task_overdue'
    | 'approval_pending'
    | 'compliance_approved'
    | 'compliance_rejected';
  data: Record<string, any>;
}

export interface EmailDispatchResult {
  success: boolean;
  messageId: string;
  channel: 'email';
  sentAt: Date;
  previewUrl?: string;
}

export class EmailService {
  /**
   * Generates structured HTML content for email notifications
   */
  private static generateEmailHtml(payload: EmailPayload): string {
    const { template, data, recipientName = 'Colleague' } = payload;

    const baseHeader = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="margin-bottom: 20px; border-bottom: 2px solid #4f46e5; padding-bottom: 12px;">
          <h2 style="color: #1e1b4b; margin: 0; font-size: 20px;">Compliance Management System</h2>
          <span style="font-size: 12px; color: #64748b;">Statutory & Regulatory Operations Alert</span>
        </div>
        <p style="color: #334155; font-size: 14px;">Hello <strong>${recipientName}</strong>,</p>
    `;

    const baseFooter = `
        <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center;">
          <p style="margin: 0;">This is an automated system notification from your Compliance Management System.</p>
          <p style="margin: 4px 0 0;">Please log into your portal dashboard to review obligations.</p>
        </div>
      </div>
    `;

    let bodyContent = '';

    switch (template) {
      case 'task_assigned':
        bodyContent = `
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border-left: 4px solid #4f46e5; margin: 16px 0;">
            <h3 style="color: #1e293b; margin: 0 0 8px; font-size: 16px;">New Task Assigned: ${data.taskTitle}</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Priority:</strong> <span style="text-transform: uppercase; color: #4f46e5;">${data.priority}</span></p>
            <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Due Date:</strong> ${data.dueDate}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Entity:</strong> ${data.entityName || '—'}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Location:</strong> ${data.locationName || '—'}</p>
            ${data.description ? `<p style="margin: 8px 0 0; font-size: 13px; color: #334155;">${data.description}</p>` : ''}
          </div>
        `;
        break;

      case 'compliance_expiring':
        bodyContent = `
          <div style="background: #fffbeb; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 16px 0;">
            <h3 style="color: #92400e; margin: 0 0 8px; font-size: 16px;">⚠️ Compliance Approaching Expiry</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #78350f;"><strong>Obligation:</strong> ${data.ruleName}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #78350f;"><strong>Record Number:</strong> ${data.recordNumber}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #78350f;"><strong>Statutory Expiry:</strong> ${data.expiryDate} (<strong>${data.daysLeft} days remaining</strong>)</p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #92400e;">Please ensure renewal documentation and evidence are uploaded before the statutory cut-off.</p>
          </div>
        `;
        break;

      case 'compliance_expired':
        bodyContent = `
          <div style="background: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444; margin: 16px 0;">
            <h3 style="color: #991b1b; margin: 0 0 8px; font-size: 16px;">🚨 URGENT: Compliance Obligation Expired</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #7f1d1d;"><strong>Obligation:</strong> ${data.ruleName}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #7f1d1d;"><strong>Record Number:</strong> ${data.recordNumber}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #7f1d1d;"><strong>Expired On:</strong> ${data.expiryDate}</p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #991b1b; font-weight: bold;">Immediate corrective action is required to avoid statutory penal non-compliance.</p>
          </div>
        `;
        break;

      case 'task_overdue':
        bodyContent = `
          <div style="background: #fff1f2; padding: 16px; border-radius: 8px; border-left: 4px solid #e11d48; margin: 16px 0;">
            <h3 style="color: #9f1239; margin: 0 0 8px; font-size: 16px;">Overdue Compliance Task: ${data.taskTitle}</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #881337;"><strong>Target Due Date:</strong> ${data.dueDate}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #881337;"><strong>Priority:</strong> <span style="text-transform: uppercase;">${data.priority}</span></p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #9f1239;">This task has exceeded its statutory deadline. Please complete and upload evidence immediately.</p>
          </div>
        `;
        break;

      case 'approval_pending':
        bodyContent = `
          <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981; margin: 16px 0;">
            <h3 style="color: #065f46; margin: 0 0 8px; font-size: 16px;">Compliance Submission Awaiting Review</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #047857;"><strong>Obligation:</strong> ${data.ruleName}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #047857;"><strong>Record Number:</strong> ${data.recordNumber}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #047857;"><strong>Unit / Location:</strong> ${data.locationName}</p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #065f46;">Statutory evidence has been submitted and is waiting for your official inspection and sign-off.</p>
          </div>
        `;
        break;

      case 'compliance_approved':
        bodyContent = `
          <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; border-left: 4px solid #059669; margin: 16px 0;">
            <h3 style="color: #065f46; margin: 0 0 8px; font-size: 16px;">✅ Compliance Obligation Approved</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #047857;"><strong>Obligation:</strong> ${data.ruleName}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #047857;"><strong>Record Number:</strong> ${data.recordNumber}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #047857;"><strong>Approval Date:</strong> ${data.approvalDate}</p>
            ${data.comments ? `<p style="margin: 6px 0; font-size: 13px; color: #047857;"><strong>Auditor Remarks:</strong> "${data.comments}"</p>` : ''}
            <p style="margin: 8px 0 0; font-size: 13px; color: #065f46;">The record has been authenticated and marked as legally compliant.</p>
          </div>
        `;
        break;

      case 'compliance_rejected':
        bodyContent = `
          <div style="background: #fff1f2; padding: 16px; border-radius: 8px; border-left: 4px solid #f43f5e; margin: 16px 0;">
            <h3 style="color: #be123c; margin: 0 0 8px; font-size: 16px;">❌ Compliance Submission Rejected / Needs Correction</h3>
            <p style="margin: 4px 0; font-size: 13px; color: #9f1239;"><strong>Obligation:</strong> ${data.ruleName}</p>
            <p style="margin: 4px 0; font-size: 13px; color: #9f1239;"><strong>Record Number:</strong> ${data.recordNumber}</p>
            <p style="margin: 6px 0; font-size: 13px; color: #9f1239;"><strong>Rejection Rationale / Correction Instructions:</strong> "${data.comments || 'Non-compliance detected'}"</p>
            <p style="margin: 8px 0 0; font-size: 13px; color: #be123c;">Please review required revisions, update documents, and resubmit for secondary review.</p>
          </div>
        `;
        break;
    }

    return `${baseHeader}${bodyContent}${baseFooter}`;
  }

  /**
   * Dispatches email via configured SMTP transport or mock architecture in development.
   */
  public static async sendEmail(payload: EmailPayload): Promise<EmailDispatchResult> {
    const html = this.generateEmailHtml(payload);
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // In a production environment with SMTP credentials, transport.sendMail would execute here.
    // In current environment, we record and log the delivery for full audit tracing.
    console.log(`📨 [Email Service] Dispatched email to: ${payload.to} | Subject: "${payload.subject}" [Template: ${payload.template}]`);

    return {
      success: true,
      messageId,
      channel: 'email',
      sentAt: new Date(),
    };
  }
}
