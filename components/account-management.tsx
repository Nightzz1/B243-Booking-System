'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type AccountView = 'overview' | 'pending' | 'members' | 'add';
type Member = {
  id: string;
  account: string;
  displayName: string;
  phone: string;
  wechat: string;
  role: 'member' | 'club_admin' | 'system_admin';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
};
export function AccountManagement({
  users,
  systemAdmin,
  busy,
  view,
  onView,
  onUpdate,
  onReset,
}: {
  users: Member[];
  systemAdmin: boolean;
  busy: boolean;
  view: AccountView;
  onView: (view: AccountView) => void;
  onUpdate: (
    id: string,
    action: 'approve' | 'reject' | 'set_role',
    role?: 'member' | 'club_admin',
  ) => Promise<void>;
  onReset: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('');
  const [lookup, setLookup] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const approved = users.filter((item) => item.status === 'approved');
  const admins = approved.filter((item) => item.role === 'club_admin');
  const pending = users.filter((item) => item.status === 'pending');
  const found = approved.find((item) => item.account === lookup);
  const titles = {
    overview: '账号管理',
    pending: '待审核账号',
    members: '社员名单',
    add: '添加管理员',
  };
  return (
    <section className="grid gap-3 rounded-2xl border bg-muted/35 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{titles[view]}</h3>
        {view !== 'overview' && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onView('overview')}
          >
            返回管理设置
          </Button>
        )}
      </div>
      {view === 'overview' && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onView('pending')}>
              待审核账号{' '}
              <span
                className={
                  pending.length
                    ? 'rounded-full bg-amber-200 px-2 font-bold text-amber-950'
                    : ''
                }
              >
                {pending.length}
              </span>
            </Button>
            <Button variant="outline" onClick={() => onView('members')}>
              社员名单
            </Button>
            {systemAdmin && (
              <Button onClick={() => onView('add')}>添加管理员</Button>
            )}
          </div>
          <h4 className="text-sm font-semibold">鼓房管理员</h4>
          {!admins.length && (
            <p className="text-sm text-muted-foreground">暂无鼓房管理员。</p>
          )}
          {admins.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"
            >
              <p>
                {item.displayName}{' '}
                <span className="text-sm text-muted-foreground">
                  {item.account}
                </span>
              </p>
              {systemAdmin &&
                (removeId === item.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">确认恢复为普通社员？</span>
                    <Button
                      disabled={busy}
                      variant="destructive"
                      onClick={() =>
                        void onUpdate(item.id, 'set_role', 'member')
                      }
                    >
                      确认移除
                    </Button>
                    <Button
                      disabled={busy}
                      variant="outline"
                      onClick={() => setRemoveId(null)}
                    >
                      取消
                    </Button>
                  </div>
                ) : (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => setRemoveId(item.id)}
                  >
                    移除管理员
                  </Button>
                ))}
            </div>
          ))}
        </>
      )}
      {view === 'pending' && (
        <>
          {!pending.length && (
            <p className="text-sm text-muted-foreground">暂无待审核账号。</p>
          )}
          {pending.map((item) => (
            <article
              key={item.id}
              className="grid gap-2 rounded-xl border bg-card p-3"
            >
              <p className="font-semibold">
                {item.displayName} · {item.account}
              </p>
              <p className="break-all text-sm">
                电话：{item.phone}　微信：{item.wechat}
              </p>
              <p className="text-sm text-muted-foreground">
                申请时间：
                {new Date(item.createdAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })}
              </p>
              {(systemAdmin || item.role === 'member') && (
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => void onUpdate(item.id, 'approve')}
                  >
                    通过
                  </Button>
                  <Button
                    disabled={busy}
                    variant="destructive"
                    onClick={() => void onUpdate(item.id, 'reject')}
                  >
                    拒绝
                  </Button>
                </div>
              )}
            </article>
          ))}
        </>
      )}
      {view === 'members' && (
        <>
          <Input
            aria-label="搜索姓名或学工号"
            placeholder="搜索姓名或学工号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {!approved.some((item) =>
            `${item.displayName} ${item.account}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
          ) && (
            <p className="text-sm text-muted-foreground">没有匹配的社员。</p>
          )}
          {approved
            .filter((item) =>
              `${item.displayName} ${item.account}`
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
            )
            .map((item) => (
              <details key={item.id} className="rounded-xl border bg-card p-3">
                <summary className="cursor-pointer break-words font-semibold">
                  {item.displayName} · {item.account}
                  {item.role === 'club_admin' ? ' · 鼓房管理员' : ''}
                </summary>
                <div className="mt-3 grid gap-2 break-all text-sm">
                  <p>电话：{item.phone}</p>
                  <p>微信：{item.wechat}</p>
                  {systemAdmin && (
                    <Button
                      className="w-fit"
                      disabled={busy}
                      variant="outline"
                      onClick={() => onReset(item.id)}
                    >
                      重置密码
                    </Button>
                  )}
                </div>
              </details>
            ))}
        </>
      )}
      {view === 'add' && systemAdmin && (
        <>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setLookup(account.trim());
            }}
          >
            <Input
              className="min-w-0 flex-1"
              aria-label="完整学工号"
              placeholder="输入完整学工号"
              value={account}
              onChange={(event) => {
                setAccount(event.target.value);
                setLookup(null);
              }}
            />
            <Button disabled={busy || !account.trim()} type="submit">
              查找社员
            </Button>
          </form>
          {lookup !== null &&
            (!found ? (
              <p className="text-sm">未找到已审核通过的社员。</p>
            ) : (
              <div className="grid gap-3 rounded-xl border bg-card p-3">
                <p>
                  {found.displayName} · {found.account}
                </p>
                {found.role === 'club_admin' ? (
                  <p className="text-sm">
                    该社员已经是鼓房管理员，无需重复设置。
                  </p>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void onUpdate(found.id, 'set_role', 'club_admin')
                    }
                  >
                    确认设为鼓房管理员
                  </Button>
                )}
              </div>
            ))}
        </>
      )}
    </section>
  );
}
