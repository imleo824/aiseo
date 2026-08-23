import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { AutomatedTask } from "../../src/types/seo";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { cronScheduler } from "../application/cronScheduler";
import { NotFoundError, ValidationError } from "../domain/errors";

export const getTasks = async (req: TenantRequest, res: Response) => {
  const tasks = fileTenantRepository.getTasks(req.tenantId);
  res.json({ tasks: tasks || [] });
};

export const createTask = async (req: TenantRequest, res: Response) => {
  const { taskName, siteId, siteName, scheduleType, scheduleTime, targetKeywordTopic, articleCountPerRun } = req.body;

  if (!taskName || !taskName.trim()) {
    throw new ValidationError("Task name is required and cannot be empty.");
  }

  const now = new Date();
  const nextDate = new Date();
  if (scheduleType === 'DAILY') {
    nextDate.setDate(nextDate.getDate() + 1);
  } else if (scheduleType === 'WEEKLY') {
    nextDate.setDate(nextDate.getDate() + 7);
  } else {
    nextDate.setHours(nextDate.getHours() + 12);
  }

  const newTask: AutomatedTask = {
    id: `task-${Date.now()}`,
    siteId: siteId || 'all',
    siteName: siteName || (siteId === 'all' ? '全部已绑定站点' : '指定站点'),
    taskName: taskName.trim(),
    scheduleType: scheduleType || 'DAILY',
    scheduleTime: scheduleTime || '09:00',
    targetKeywordTopic: (targetKeywordTopic && String(targetKeywordTopic).trim()) || 'AI 架构与企业级自动化最佳实践',
    articleCountPerRun: Number(articleCountPerRun) || 1,
    status: 'ACTIVE',
    lastRunAt: undefined,
    nextRunAt: nextDate.toISOString(),
    createdAt: now.toISOString()
  };

  await fileTenantRepository.saveTask(req.tenantId, newTask);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: newTask.siteId,
    timestamp: now.toISOString(),
    actor: 'USER_ADMIN',
    action: 'CREATE_SCHEDULED_TASK',
    target: newTask.taskName,
    result: 'SUCCESS',
    details: `已创建自动化巡航任务，执行周期: ${newTask.scheduleType} (${newTask.scheduleTime})`
  });

  res.status(201).json({ task: newTask });
};

export const updateTask = async (req: TenantRequest, res: Response) => {
  const tasks = fileTenantRepository.getTasks(req.tenantId);
  const task = tasks.find(t => t.id === req.params.id);

  if (!task) {
    throw new NotFoundError(`Task with ID "${req.params.id}" was not found.`);
  }

  const { taskName, siteId, siteName, scheduleType, scheduleTime, targetKeywordTopic, articleCountPerRun, status } = req.body;

  if (taskName !== undefined) task.taskName = String(taskName).trim();
  if (siteId !== undefined) task.siteId = siteId;
  if (siteName !== undefined) task.siteName = siteName;
  if (scheduleType !== undefined) task.scheduleType = scheduleType;
  if (scheduleTime !== undefined) task.scheduleTime = scheduleTime;
  if (targetKeywordTopic !== undefined) task.targetKeywordTopic = String(targetKeywordTopic).trim();
  if (articleCountPerRun !== undefined) task.articleCountPerRun = Number(articleCountPerRun);
  if (status !== undefined) task.status = status;

  await fileTenantRepository.saveTask(req.tenantId, task);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: task.siteId,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'UPDATE_SCHEDULED_TASK',
    target: task.taskName,
    result: 'SUCCESS',
    details: `已更新定时巡航任务配置 (状态: ${task.status})`
  });

  res.json({ task });
};

export const deleteTask = async (req: TenantRequest, res: Response) => {
  const tasks = fileTenantRepository.getTasks(req.tenantId);
  const task = tasks.find(t => t.id === req.params.id);

  if (!task) {
    throw new NotFoundError(`Task with ID "${req.params.id}" was not found.`);
  }

  await fileTenantRepository.deleteTask(req.tenantId, req.params.id);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: task.siteId,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'DELETE_SCHEDULED_TASK',
    target: task.taskName,
    result: 'SUCCESS',
    details: `已删除自动化巡航任务「${task.taskName}」`
  });

  res.json({ success: true, message: `任务 ${task.taskName} 已删除。` });
};

export const runTaskNow = async (req: TenantRequest, res: Response) => {
  const tasks = fileTenantRepository.getTasks(req.tenantId);
  const task = tasks.find(t => t.id === req.params.id);

  if (!task) {
    throw new NotFoundError(`Task with ID "${req.params.id}" was not found.`);
  }

  const success = await cronScheduler.runTaskImmediately(req.tenantId, task.id);
  res.json({ success, message: `定时任务「${task.taskName}」已手动触发执行` });
};
