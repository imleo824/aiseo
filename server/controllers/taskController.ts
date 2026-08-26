import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { AutomatedTask } from "../../src/types/seo";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { cronScheduler } from "../application/cronScheduler";
import { NotFoundError, ValidationError } from "../domain/errors";
import { validateTaskInput } from '../utils/validator';
import { nextTaskRunAt, validateScheduleTime, type TaskScheduleType } from '../utils/taskSchedule';

export const getTasks = async (req: TenantRequest, res: Response) => {
  const tasks = fileTenantRepository.getTasks(req.tenantId);
  res.json({ tasks: tasks || [] });
};

export const createTask = async (req: TenantRequest, res: Response) => {
  const validation = validateTaskInput(req.body);
  if (!validation.isValid) throw new ValidationError(validation.errors.join(', '));
  const { taskName, siteId, siteName, scheduleType, scheduleTime, targetKeywordTopic, articleCountPerRun } = req.body;

  if (!taskName || !taskName.trim()) {
    throw new ValidationError("Task name is required and cannot be empty.");
  }

  const now = new Date();
  const resolvedScheduleType = (scheduleType || 'DAILY') as TaskScheduleType;
  const resolvedScheduleTime = resolvedScheduleType === 'INTERVAL'
    ? String(scheduleTime || '00:00')
    : validateScheduleTime(scheduleTime || '09:00');
  const nextDate = nextTaskRunAt(resolvedScheduleType, resolvedScheduleTime, now);

  const newTask: AutomatedTask = {
    id: `task-${Date.now()}`,
    siteId: siteId || 'all',
    siteName: siteName || (siteId === 'all' ? '全部已绑定站点' : '指定站点'),
    taskName: taskName.trim(),
    scheduleType: resolvedScheduleType,
    scheduleTime: resolvedScheduleTime,
    targetKeywordTopic: (targetKeywordTopic && String(targetKeywordTopic).trim()) || 'AI 架构与企业级自动化最佳实践',
    articleCountPerRun: Number(articleCountPerRun) || 1,
    totalArticles: 0,
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

  const { taskName, siteId, siteName, scheduleType, scheduleTime, targetKeywordTopic, articleCountPerRun, totalArticles, status } = req.body;
  if (scheduleType !== undefined && !['DAILY', 'WEEKLY', 'INTERVAL'].includes(scheduleType)) throw new ValidationError('调度周期无效');
  if (articleCountPerRun !== undefined && (!Number.isInteger(Number(articleCountPerRun)) || Number(articleCountPerRun) < 1 || Number(articleCountPerRun) > 50)) throw new ValidationError('单次生成篇数必须在 1 到 50 之间');
  if (status !== undefined && !['ACTIVE', 'PAUSED'].includes(status)) throw new ValidationError('任务状态无效');

  if (taskName !== undefined) task.taskName = String(taskName).trim();
  if (siteId !== undefined) task.siteId = siteId;
  if (siteName !== undefined) task.siteName = siteName;
  if (scheduleType !== undefined) task.scheduleType = scheduleType;
  if (scheduleTime !== undefined) task.scheduleTime = task.scheduleType === 'INTERVAL' ? String(scheduleTime) : validateScheduleTime(scheduleTime);
  if (targetKeywordTopic !== undefined) task.targetKeywordTopic = String(targetKeywordTopic).trim();
  if (articleCountPerRun !== undefined) task.articleCountPerRun = Number(articleCountPerRun);
  if (totalArticles !== undefined) task.totalArticles = Number(totalArticles);
  if (status !== undefined) task.status = status;
  if (scheduleType !== undefined || scheduleTime !== undefined || status === 'ACTIVE') {
    task.nextRunAt = nextTaskRunAt(task.scheduleType as TaskScheduleType, task.scheduleTime, new Date()).toISOString();
  }

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
  const updatedTasks = fileTenantRepository.getTasks(req.tenantId);
  const updatedTask = updatedTasks.find(t => t.id === req.params.id) || task;
  res.json({
    success,
    message: success
      ? `定时任务「${task.taskName}」已完成至少一篇自动发布`
      : `定时任务「${task.taskName}」未完成发布，请查看任务审计日志`,
    task: updatedTask
  });
};
