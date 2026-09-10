'use client';

import { useState, type SyntheticEvent } from 'react';
import type { AuthUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function AccountSettings({
  user,
  onClose,
  onUpdate,
  onPasswordChanged,
}: {
  user: AuthUser;
  onClose: () => void;
  onUpdate: (user: AuthUser) => void;
  onPasswordChanged: () => void;
}) {
  const [phone, setPhone] = useState(user.phone);
  const [wechat, setWechat] = useState(user.wechat);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  async function save(
    event: SyntheticEvent<HTMLFormElement>,
    action: 'profile' | 'password',
  ) {
    event.preventDefault();
    if (busy) return;
    setMessage('');
    setFailed(false);
    if (action === 'password' && newPassword !== confirmation) {
      setMessage('两次输入的新密码不一致。');
      setFailed(true);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'profile'
            ? { action, phone, wechat }
            : { action, currentPassword, newPassword },
        ),
      });
      const data = (await response.json()) as {
        user?: AuthUser;
        error?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(data.error ?? '保存失败，请稍后重试。');
      setMessage(data.message ?? '已保存。');
      if (action === 'password') {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmation('');
        setPasswordChanged(true);
      } else if (data.user) onUpdate(data.user);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : '保存失败，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) (passwordChanged ? onPasswordChanged : onClose)();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>账号管理</DialogTitle>
          <DialogDescription>
            {user.displayName} · {user.account}
          </DialogDescription>
        </DialogHeader>
        {message && (
          <p
            role={failed ? 'alert' : 'status'}
            className={
              failed ? 'text-sm text-destructive' : 'text-sm text-foreground'
            }
          >
            {message}
          </p>
        )}
        {passwordChanged ? (
          <Button onClick={onPasswordChanged}>使用新密码重新登录</Button>
        ) : user.role === 'system_admin' ? (
          <p className="text-sm text-muted-foreground">
            系统管理员的联系方式和密码由服务器配置管理，请联系服务器维护者修改。
          </p>
        ) : (
          <>
            <form
              className="space-y-3"
              onSubmit={(event) => void save(event, 'profile')}
            >
              <h3 className="font-semibold">联系方式</h3>
              <p className="text-xs text-muted-foreground">
                其他已审核社员可通过你的预约查看电话和微信，请填写便于联系的信息。
              </p>
              <label className="grid gap-1.5" htmlFor="account-phone">
                电话号码
                <Input
                  id="account-phone"
                  autoComplete="tel"
                  type="tel"
                  required
                  minLength={6}
                  maxLength={32}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5" htmlFor="account-wechat">
                微信号
                <Input
                  id="account-wechat"
                  required
                  maxLength={64}
                  value={wechat}
                  onChange={(event) => setWechat(event.target.value)}
                />
              </label>
              <Button disabled={busy} type="submit">
                保存联系方式
              </Button>
            </form>
            <form
              className="space-y-3 border-t pt-4"
              onSubmit={(event) => void save(event, 'password')}
            >
              <h3 className="font-semibold">修改密码</h3>
              <p className="text-xs text-muted-foreground">
                使用 8–128
                个字符。修改成功后，包括当前设备在内的所有设备都需要重新登录。
              </p>
              <input
                type="text"
                autoComplete="username"
                value={user.account}
                readOnly
                hidden
              />
              <label
                className="grid gap-1.5"
                htmlFor="account-current-password"
              >
                当前密码
                <Input
                  id="account-current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label className="grid gap-1.5" htmlFor="account-new-password">
                新密码
                <Input
                  id="account-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label
                className="grid gap-1.5"
                htmlFor="account-confirm-password"
              >
                确认新密码
                <Input
                  id="account-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <Button disabled={busy} type="submit" variant="outline">
                修改密码
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
