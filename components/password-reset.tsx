'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function AdminPasswordReset({
  target,
  onClose,
}: {
  target: { id: string; account: string; displayName: string };
  onClose: () => void;
}) {
  const [result, setResult] = useState<{
    newPassword: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  async function reset() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/users/${target.id}/reset-password`,
        { method: 'POST' },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '重置失败。');
      setResult(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : '重置失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.newPassword);
      setCopied(true);
    } catch {
      setError('无法自动复制，请手动选中新密码复制。');
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>重置密码</DialogTitle>
          <DialogDescription>
            {target.displayName} · {target.account}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {result ? (
          <>
            <p className="text-sm">
              旧密码和所有旧会话已失效。请将新密码私下交给已核实身份的本人。
            </p>
            <label htmlFor="generated-password" className="grid gap-2 text-sm">
              新密码（仅本次显示）
              <Input
                id="generated-password"
                readOnly
                value={result.newPassword}
                className="font-mono"
                onFocus={(event) => event.target.select()}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              新密码可直接正常登录，也可由社员在账号管理中自行修改。关闭后无法再次查看，请先复制保存。
            </p>
            <Button onClick={() => void copy()} variant="outline">
              {copied ? '已复制' : '复制新密码'}
            </Button>
            <Button onClick={onClose}>完成</Button>
          </>
        ) : (
          <>
            <p className="text-sm">
              请先核实对方身份。确认后将立即撤销该账号所有登录会话，使旧密码失效，并生成一个随机新密码。
            </p>
            <Button disabled={busy} onClick={() => void reset()}>
              {busy ? '正在生成…' : '确认重置并生成新密码'}
            </Button>
            <Button disabled={busy} variant="outline" onClick={onClose}>
              取消
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
