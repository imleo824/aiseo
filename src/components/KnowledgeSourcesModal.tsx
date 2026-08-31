import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, FileText, Plus, X } from 'lucide-react';
import { createApiService } from '../services/api';
import type { KnowledgeSource, WordPressSite } from '../types/seo';

type Props = { site: WordPressSite; onClose: () => void };

export const KnowledgeSourcesModal: React.FC<Props> = ({ site, onClose }) => {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<'CLIENT_KB' | 'ORIGINAL_RESEARCH'>('CLIENT_KB');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await createApiService().getKnowledgeBase(site.id);
      setSources(result.knowledgeSources);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '知识来源加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [site.id]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || content.trim().length < 40) {
      setMessage('标题不能为空，正文至少需要 40 个字符');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await createApiService().addKnowledgeSource(site.id, { title: title.trim(), type, contentSnippet: content.trim() });
      setTitle('');
      setContent('');
      await load();
      setMessage('知识来源已保存并进入内容溯源链路');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '知识来源保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full my-8 max-h-[92vh] flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/90 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white grid place-items-center"><BookOpen className="w-4 h-4" /></div>
            <div><h3 className="font-bold text-base text-slate-900">知识来源</h3><p className="text-xs text-slate-500 mt-0.5">{site.name}</p></div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          {message && <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">{message}</div>}
          <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-900"><Plus className="w-4 h-4" />添加真实知识来源</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select value={type} onChange={(event) => setType(event.target.value as typeof type)} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">
                <option value="CLIENT_KB">客户资料</option><option value="ORIGINAL_RESEARCH">原创研究</option>
              </select>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="来源标题" className="sm:col-span-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
            </div>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={6} placeholder="粘贴您拥有使用权的事实资料、产品说明、研究数据或品牌信息（至少 40 字）" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs leading-5 resize-y" />
            <div className="flex items-center justify-between gap-3"><p className="text-[11px] text-slate-500">正文会持久化并记录到文章数据溯源中。</p><button type="submit" disabled={submitting} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold disabled:opacity-50">{submitting ? '保存中…' : '保存来源'}</button></div>
          </form>
          <div className="space-y-2">
            <div className="font-bold text-sm text-slate-900">已保存来源（{sources.length}）</div>
            {loading ? <div className="py-6 text-center text-xs text-slate-500">正在加载…</div> : sources.length === 0 ? <div className="py-8 text-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">尚未添加知识来源，内容生成会失败关闭。</div> : sources.map((source) => (
              <div key={source.id} className="rounded-xl border border-slate-200 p-3 flex items-start gap-3"><FileText className="w-4 h-4 text-slate-500 mt-0.5" /><div className="min-w-0 flex-1"><div className="text-xs font-bold text-slate-900">{source.title}</div><div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{source.contentSnippet}</div></div><span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />可用</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
