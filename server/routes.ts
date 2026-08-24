import { Router } from "express";
import { asyncHandler } from "./utils/asyncHandler";
import { 
  getTasks, 
  createTask, 
  updateTask, 
  deleteTask, 
  runTaskNow,
  getSites, 
  getSiteById, 
  createSite, 
  updateSite, 
  deleteSite, 
  toggleAutopilot,
  testSiteConnection,
  getSiteOpportunities, 
  scanOpportunities, 
  scanCompetitorAttack,
  serpScan,
  generateBrief, 
  generateArticle,
  approveAndPublishDraft, 
  rollbackDraft,
  getDrafts,
  getSiteKnowledgeBase, 
  addSiteKnowledgeSource,
  getSiteAuditLogs, 
  getUsageLedger, 
  getBaiduLogs, 
  getGrowthMetrics,
  authController,
  creditController,
  systemServiceConfigController
} from "./controllers";

export const apiRouter = Router();

// Auth & Tenant Management Routes
apiRouter.post("/auth/login", asyncHandler(authController.login));
apiRouter.post("/auth/register", asyncHandler(authController.register));
apiRouter.get("/auth/me", asyncHandler(authController.getMe));
apiRouter.get("/auth/tenants", asyncHandler(authController.listTenants));

// Credit & USDT Payment Routes
apiRouter.get("/credits/config", asyncHandler(creditController.getConfig));
apiRouter.put("/credits/config", asyncHandler(creditController.updateConfig));
apiRouter.post("/credits/config/reset", asyncHandler(creditController.resetConfig));
apiRouter.get("/credits/balance", asyncHandler(creditController.getBalance));
apiRouter.get("/credits/transactions", asyncHandler(creditController.getTransactions));
apiRouter.post("/credits/recharge", asyncHandler(creditController.recharge));

// Admin Global Management Routes
apiRouter.get("/admin/transactions", asyncHandler(creditController.getAllTransactions));
apiRouter.get("/admin/usages", asyncHandler(creditController.getAllUsages));
apiRouter.post("/admin/tenants/adjust-credits", asyncHandler(creditController.adjustCredits));
apiRouter.post("/admin/payments/confirm", asyncHandler(creditController.confirmPayment));

// System Services & API Configuration Routes (Admin Only)
apiRouter.get("/system/services-config", asyncHandler(systemServiceConfigController.getServicesConfig));
apiRouter.put("/system/services-config", asyncHandler(systemServiceConfigController.updateServicesConfig));
apiRouter.post("/system/services-config/reset", asyncHandler(systemServiceConfigController.resetServicesConfig));
apiRouter.post("/system/services-config/test-connection", asyncHandler(systemServiceConfigController.testServiceConnection));

// Tasks Routes
apiRouter.get("/tasks", asyncHandler(getTasks));
apiRouter.post("/tasks", asyncHandler(createTask));
apiRouter.put("/tasks/:id", asyncHandler(updateTask));
apiRouter.delete("/tasks/:id", asyncHandler(deleteTask));
apiRouter.post("/tasks/:id/run", asyncHandler(runTaskNow));

// Sites Routes
apiRouter.get("/sites", asyncHandler(getSites));
apiRouter.post("/sites", asyncHandler(createSite));
apiRouter.get("/sites/:id", asyncHandler(getSiteById));
apiRouter.put("/sites/:id", asyncHandler(updateSite));
apiRouter.delete("/sites/:id", asyncHandler(deleteSite));
apiRouter.post("/sites/:id/toggle-autopilot", asyncHandler(toggleAutopilot));
apiRouter.post("/sites/:id/test-connection", asyncHandler(testSiteConnection));

// Opportunities Routes
apiRouter.get("/sites/:id/opportunities", asyncHandler(getSiteOpportunities));
apiRouter.post("/sites/:id/scan-opportunities", asyncHandler(scanOpportunities));
apiRouter.post("/sites/:id/competitor-attack", asyncHandler(scanCompetitorAttack));
apiRouter.post("/keywords/serp-scan", asyncHandler(serpScan));
apiRouter.post("/opportunities/:oppId/generate-brief", asyncHandler(generateBrief));
apiRouter.post("/opportunities/:oppId/generate-article", asyncHandler(generateArticle));

// Drafts Routes
apiRouter.get("/drafts", asyncHandler(getDrafts));
apiRouter.post("/drafts/:id/approve-publish", asyncHandler(approveAndPublishDraft));
apiRouter.post("/drafts/:id/rollback", asyncHandler(rollbackDraft));

// Knowledge Base Routes
apiRouter.get("/sites/:id/knowledge-base", asyncHandler(getSiteKnowledgeBase));
apiRouter.post("/sites/:id/knowledge-base", asyncHandler(addSiteKnowledgeSource));

// Logs & Ledger & Metrics Routes
apiRouter.get("/sites/:id/audit-logs", asyncHandler(getSiteAuditLogs));
apiRouter.get("/usage-ledger", asyncHandler(getUsageLedger));
apiRouter.get("/baidu-logs", asyncHandler(getBaiduLogs));
apiRouter.get("/sites/:id/growth-metrics", asyncHandler(getGrowthMetrics));

