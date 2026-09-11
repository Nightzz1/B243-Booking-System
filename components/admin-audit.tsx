'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
type Log = {
  id: string;
  created_at: string;
  actor_account: string;
  actor_name: string;
  action: string;
  target: string;
  details: object;
};
const labels: Record<string, string> = {
  'account.approve': '通过账号审核',
  'account.reject': '拒绝账号',
  'account.set_role': '修改账号身份',
  'account.reset_password': '重置密码',
  'lesson.create': '新建鼓课',
  'lesson.update': '修改鼓课',
  'lesson.delete': '删除鼓课',
  'lesson.end': '结束鼓课',
  'lesson.pause': '鼓课停课',
  'lesson.resume': '恢复鼓课',
  'settings.semester': '修改学期',
  'activity.create': '登记活动',
  'schedule.cancel': '取消预约或活动',
};
export function AdminAudit({ onBack }: { onBack: () => void }) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [logs, setLogs] = useState<Log[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setError('');
      try {
        const response = await fetch(`/api/admin/audit-logs?page=${page}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!controller.signal.aborted) {
          setLogs(data.logs);
          setMore(data.hasMore);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '加载失败');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [page, revision]);
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-bold">管理操作记录</h3>
        <Button variant="outline" onClick={onBack}>
          返回管理设置
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        记录功能启用后的成功管理操作，按时间倒序显示。密码不会记录。
      </p>
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !logs.length && <p>暂无操作记录。</p>}
      {logs.map((log) => (
        <article
          key={log.id}
          className="grid gap-1 rounded-xl border p-3 text-sm"
        >
          <p className="font-semibold">{labels[log.action] ?? log.action}</p>
          <p>
            {log.actor_name}（{log.actor_account}） ·{' '}
            {new Date(log.created_at).toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
            })}
          </p>
          <p className="break-all text-muted-foreground">对象：{log.target}</p>
          <details>
            <summary className="cursor-pointer">操作详情</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(log.details, null, 2)}
            </pre>
          </details>
        </article>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || page === 0}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={busy || !more}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRevision(revision + 1)}
        >
          刷新
        </Button>
      </div>
    </section>
  );
}
