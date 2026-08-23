import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { KnowledgeSource } from "../../src/types/seo";
import { validateKnowledgeInput } from "../utils/validator";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { ValidationError } from "../domain/errors";

export const getSiteKnowledgeBase = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const kb = tenantData.knowledgeSources.filter(k => k.siteId === req.params.id);
  res.json({ knowledgeSources: kb });
};

export const addSiteKnowledgeSource = async (req: TenantRequest, res: Response) => {
  const validation = validateKnowledgeInput(req.body);
  if (!validation.isValid) {
    throw new ValidationError(validation.errors.join(", "), { details: validation.errors });
  }

  const { title, type, contentSnippet, urlOrFilename } = req.body;
  const newKb: KnowledgeSource = {
    id: `kb-${Date.now()}`,
    siteId: req.params.id,
    title: title.trim(),
    type: type || 'CLIENT_KB',
    contentSnippet: contentSnippet.trim(),
    urlOrFilename: (urlOrFilename && String(urlOrFilename).trim()) || undefined,
    addedAt: new Date().toISOString()
  };

  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  tenantData.knowledgeSources.unshift(newKb);
  await fileTenantRepository.saveTenantData(req.tenantId, tenantData);

  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: req.params.id,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'ADD_KNOWLEDGE_SOURCE',
    target: newKb.title,
    result: 'SUCCESS',
    details: '已添加新的知识库事实材料，将作为 AI 写作质检的严格可信依据。'
  });

  res.status(201).json({ knowledgeSource: newKb });
};
