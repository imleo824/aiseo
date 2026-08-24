import { eventBus, DomainEvent } from '../domain/eventBus';
import { systemServiceConfigRepository } from '../infrastructure/persistence/systemServiceConfigRepository';
import { logger } from '../utils/logger';

export class WebhookNotifier {
  private initialized = false;

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    eventBus.subscribe('ARTICLE_PUBLISHED', async (evt) => {
      await this.handleEvent('ARTICLE_PUBLISHED', evt, '🎉 文章全流程自动生成并已同步发布');
    });

    eventBus.subscribe('QUALITY_GATE_FAILED', async (evt) => {
      await this.handleEvent('QUALITY_GATE_FAILED', evt, '⚠️ 自动巡航质量门禁拦截告警');
    });

    eventBus.subscribe('TASK_SCHEDULED_RUN', async (evt) => {
      if ((evt.payload as any)?.status === 'FAILED') {
        await this.handleEvent('TASK_SCHEDULED_RUN', evt, '🚨 定时巡航任务执行失败');
      }
    });

    logger.info('WEBHOOK_NOTIFIER', 'Webhook Notifier event subscriptions initialized');
  }

  private async handleEvent(eventType: string, event: DomainEvent, title: string): Promise<void> {
    const config = systemServiceConfigRepository.getServicesConfig();
    const webhook = config.webhookNotification;

    if (!webhook || !webhook.enabled || !webhook.webhookUrl) {
      return;
    }

    if (eventType === 'ARTICLE_PUBLISHED' && !webhook.events.onPublishSuccess) return;
    if (eventType === 'QUALITY_GATE_FAILED' && !webhook.events.onTaskFailure) return;
    if (eventType === 'TASK_SCHEDULED_RUN' && !webhook.events.onTaskFailure) return;

    const payload = this.formatPayload(webhook.webhookType, title, {
      eventType,
      tenantId: event.tenantId,
      siteId: event.siteId,
      timestamp: event.timestamp,
      data: event.payload
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(webhook.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        logger.warn('WEBHOOK_NOTIFIER', `Webhook post failed with status ${res.status}`);
      } else {
        logger.info('WEBHOOK_NOTIFIER', `Successfully sent webhook notification: ${title} (${eventType})`);
      }
    } catch (err: any) {
      logger.warn('WEBHOOK_NOTIFIER', `Webhook delivery error: ${err?.message}`);
    }
  }

  public async sendTestNotification(customUrl?: string, customType?: string): Promise<{ success: boolean; latencyMs: number; message: string; statusCode?: number }> {
    const config = systemServiceConfigRepository.getServicesConfig();
    const targetUrl = customUrl || config.webhookNotification?.webhookUrl;
    const type = (customType || config.webhookNotification?.webhookType || 'FEISHU') as any;

    if (!targetUrl) {
      return { success: false, latencyMs: 0, message: '未配置 Webhook 接收地址 URL' };
    }

    const payload = this.formatPayload(type, '🔔 系统管理测试通知 (SEO Autopilot SaaS)', {
      eventType: 'SYSTEM_TEST',
      tenantId: 'system-admin',
      timestamp: new Date().toISOString(),
      data: {
        status: 'ONLINE',
        detail: '这是一条来自 SEO Autopilot SaaS 系统服务配置的连通性测试消息，说明 Webhook 集成与网络通道正常。'
      }
    });

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;

      if (res.ok) {
        return {
          success: true,
          latencyMs,
          statusCode: res.status,
          message: `Webhook 测试推送成功 (耗时: ${latencyMs}ms, 状态码: ${res.status})`
        };
      } else {
        const text = await res.text().catch(() => '');
        return {
          success: false,
          latencyMs,
          statusCode: res.status,
          message: `Webhook 接收方返回错误状态码 ${res.status}: ${text.slice(0, 100)}`
        };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return {
        success: false,
        latencyMs,
        message: `Webhook 发送失败: ${err?.message}`
      };
    }
  }

  private formatPayload(type: string, title: string, data: any): any {
    const contentText = `【${title}】\n- 租户: ${data.tenantId}\n- 时间: ${new Date(data.timestamp).toLocaleString('zh-CN')}\n- 详情: ${JSON.stringify(data.data)}`;

    switch (type) {
      case 'FEISHU':
        return {
          msg_type: 'text',
          content: {
            text: `${title}\n• 租户 ID: ${data.tenantId}\n• 时间: ${new Date(data.timestamp).toLocaleString('zh-CN')}\n• 事件类型: ${data.eventType}\n• 详细数据: ${JSON.stringify(data.data, null, 2)}`
          }
        };
      case 'DINGTALK':
        return {
          msgtype: 'text',
          text: {
            content: `${title}\n${contentText}`
          }
        };
      case 'WECHAT_WORK':
        return {
          msgtype: 'text',
          text: {
            content: `${title}\n${contentText}`
          }
        };
      case 'SLACK':
      case 'DISCORD':
        return {
          text: `*${title}*\n>${contentText.replace(/\n/g, '\n>')}`
        };
      case 'CUSTOM':
      default:
        return {
          title,
          ...data
        };
    }
  }
}

export const webhookNotifier = new WebhookNotifier();
