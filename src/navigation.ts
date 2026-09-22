import type { NavItem } from './types/seo';

export type WorkspaceResource = 'drafts' | 'tasks' | 'transactions' | 'tenants' | 'growthStatus' | 'pricing';

type NavigationDefinition = {
  label: string;
  title: string;
  audience: 'CUSTOMER' | 'ADMIN';
  resources: readonly WorkspaceResource[];
};

export const NAVIGATION = {
  DASHBOARD: { label: '手动执行', title: '手动执行', audience: 'CUSTOMER', resources: ['drafts', 'growthStatus'] },
  AUTOPILOT_TASKS: { label: '自动执行', title: '自动执行', audience: 'CUSTOMER', resources: ['tasks'] },
  SITE_MANAGEMENT: { label: '我的站点', title: '我的站点', audience: 'CUSTOMER', resources: [] },
  AUDIT_LEDGER: { label: '我的内容', title: '我的内容', audience: 'CUSTOMER', resources: ['drafts'] },
  CREDIT_LEDGER: { label: '我的账单', title: '账单明细', audience: 'CUSTOMER', resources: ['transactions', 'pricing'] },
  ACCOUNT_DATA: { label: '账号与数据', title: '账号与数据', audience: 'CUSTOMER', resources: [] },
  PRICING_CONFIG: { label: '付费配置', title: '付费价格配置', audience: 'ADMIN', resources: [] },
  SYSTEM_SERVICES_CONFIG: { label: '全局设置', title: '全局系统设置', audience: 'ADMIN', resources: [] },
  TENANT_MANAGEMENT: { label: '客户管理', title: '客户工作区管理', audience: 'ADMIN', resources: ['tenants'] },
  SYSTEM_PAYMENT_MANAGEMENT: { label: '充值监控', title: '充值订单监控', audience: 'ADMIN', resources: [] },
  SYSTEM_BILLING_MANAGEMENT: { label: '用量审计', title: '用量与扣费审计', audience: 'ADMIN', resources: [] }
} as const satisfies Record<NavItem, NavigationDefinition>;

export const CUSTOMER_NAV_GROUPS: ReadonlyArray<{ title: string; items: readonly NavItem[] }> = [
  { title: '搜索增长', items: ['DASHBOARD', 'AUTOPILOT_TASKS'] },
  { title: '资产与内容', items: ['SITE_MANAGEMENT', 'AUDIT_LEDGER'] },
  { title: '账户与账单', items: ['CREDIT_LEDGER', 'ACCOUNT_DATA'] }
];

export const ADMIN_NAV_ITEMS = [
  'PRICING_CONFIG',
  'TENANT_MANAGEMENT',
  'SYSTEM_PAYMENT_MANAGEMENT',
  'SYSTEM_BILLING_MANAGEMENT',
  'SYSTEM_SERVICES_CONFIG'
] as const satisfies readonly NavItem[];

export const MOBILE_PRIMARY_NAV_ITEMS = ['DASHBOARD', 'SITE_MANAGEMENT', 'AUDIT_LEDGER'] as const satisfies readonly NavItem[];

const NAV_ITEMS = new Set<NavItem>(Object.keys(NAVIGATION) as NavItem[]);
const ADMIN_ITEMS = new Set<NavItem>(ADMIN_NAV_ITEMS);

export const isNavItem = (value: string | null): value is NavItem => Boolean(value && NAV_ITEMS.has(value as NavItem));
export const isAdminNavItem = (value: NavItem): boolean => ADMIN_ITEMS.has(value);
export const requiresWorkspaceResource = (view: NavItem, resource: WorkspaceResource): boolean => (
  NAVIGATION[view].resources as readonly WorkspaceResource[]
).includes(resource);

export const navFromSearch = (search: string): NavItem => {
  const requested = new URLSearchParams(search).get('view');
  return isNavItem(requested) ? requested : 'DASHBOARD';
};
