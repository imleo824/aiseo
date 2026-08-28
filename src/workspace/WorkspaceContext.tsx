import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type PropsWithChildren } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Me, Organization } from '../types/api';

type WorkspaceContextValue = { me: Me; organization: Organization; setOrganizationId: (id: string) => void };
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const meQuery = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/me').then(({ data }) => data) });
  const [organizationId, setOrganizationId] = useState<string>('');
  useEffect(() => {
    if (!organizationId && meQuery.data?.organizations[0]) setOrganizationId(meQuery.data.organizations[0].id);
  }, [meQuery.data, organizationId]);
  if (meQuery.isLoading) return <div className="screen-center">正在加载账号…</div>;
  if (meQuery.error) throw meQuery.error;
  if (!meQuery.data) throw new Error('账号数据不可用');
  const organization = meQuery.data.organizations.find(({ id }) => id === organizationId) || meQuery.data.organizations[0];
  if (!organization) return <BootstrapOrganization />;
  const value = useMemo(() => ({ me: meQuery.data!, organization, setOrganizationId }), [meQuery.data, organization]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function BootstrapOrganization() {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    try { await api.post('/bootstrap', { name }); window.location.reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '创建失败'); }
  };
  return <main className="screen-center p-6"><form onSubmit={submit} className="panel w-full max-w-lg space-y-4"><h1 className="text-xl font-bold">创建首个组织</h1><p className="muted">新组织余额为 0，不赠送测试积分。</p><input className="field" placeholder="组织名称" value={name} onChange={(event) => setName(event.target.value)} required />{message && <p className="error-text">{message}</p>}<button className="primary">创建组织</button></form></main>;
}

export const useWorkspace = () => {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
};
