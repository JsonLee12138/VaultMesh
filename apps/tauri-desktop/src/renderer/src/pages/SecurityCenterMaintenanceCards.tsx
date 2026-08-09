import { CreditCardIcon, ContactIcon, DownloadIcon, HistoryIcon, KeyRoundIcon, MergeIcon, RefreshCwIcon, RotateCcwIcon, ShieldCheckIcon, TerminalIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SecurityCenterModel } from './security-center-model';
import { ConfirmAction, EmptyState, ItemCard, SecurityFeatureCard, formatTime } from './security-center-ui';

export function SecurityCenterMaintenanceCards({ model }: { model: SecurityCenterModel }) {
  const { busy, cardHistory, cardHistoryItemId, cardTrash, cards, changePassword, confirmation, currentPassword, duplicateGroups, health, history, historyItemId, identities, identityHistory, identityHistoryItemId, identityTrash, issueMap, items, loadCardHistory, loadHistory, loadIdentityHistory, loadSshHistory, mergeDuplicateGroup, mergePrimaryIds, newPassword, refreshVault, reload, restorePassword, run, setCardHistory, setConfirmation, setCurrentPassword, setHistory, setIdentityHistory, setMergePrimaryIds, setNewPassword, setRestorePassword, setSshHistory, sshCredentials, sshHistory, sshHistoryItemId, sshTrash, trash } = model;
  return <>
        <SecurityFeatureCard
          icon={ShieldCheckIcon}
          title="密码健康"
          description="分析在 Rust 加密核心中完成，界面不会收到密码或摘要。"
          summary={health ? `${health.score} / 100 · ${issueMap.size} 项需关注` : '正在读取安全状态…'}
          actionLabel="查看健康报告"
          footer={
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => void run(reload, '安全状态已刷新。')}
            >
              <RefreshCwIcon data-icon="inline-start" />
              重新检查
            </Button>
          }
        >
          <Card size="sm">
            <CardHeader>
              <CardTitle>健康评分</CardTitle>
              <CardDescription>综合弱密码、重复使用和密码使用时长。</CardDescription>
              <CardAction>{health?.score ?? '—'} / 100</CardAction>
            </CardHeader>
          </Card>
          <div className="flex flex-col gap-3">
            {issueMap.size === 0 ? (
              <EmptyState
                icon={ShieldCheckIcon}
                title="未发现密码风险"
                description="当前没有弱、重复或超过 180 天的密码。"
              />
            ) : (
              items
                .filter((item) => issueMap.has(item.id))
                .map((item) => (
                  <ItemCard
                    key={item.id}
                    title={item.title}
                    description={issueMap.get(item.id)?.join(' · ') ?? ''}
                  />
                ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={MergeIcon}
          title="检查重复"
          description="按规范化的网站域名与用户名识别重复登录信息。"
          summary={duplicateGroups.length > 0 ? `${duplicateGroups.length} 组重复登录信息待处理` : '未发现重复登录信息'}
          actionLabel="检查重复登录信息"
        >
          {duplicateGroups.length === 0 ? (
            <EmptyState
              icon={MergeIcon}
              title="未发现重复登录信息"
              description="具有相同网站域名和用户名的登录信息会显示在这里。"
            />
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">选择要保留的项目后，会合并网站、备注、文件夹、收藏和自定义字段；保留项目的密码与验证器不会被替换，其余项目会移入回收站。</p>
              {duplicateGroups.map((group) => {
                const primaryId = mergePrimaryIds[group.key] ?? group.items[0]?.id;
                return (
                  <Card size="sm" key={group.key}>
                    <CardHeader>
                      <CardTitle>{group.label}</CardTitle>
                      <CardDescription>{group.items.length} 条登录信息</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                      {group.items.map((item) => (
                        <label className="flex cursor-pointer items-center gap-2 text-sm" key={item.id}>
                          <input
                            type="radio"
                            name={group.key}
                            checked={primaryId === item.id}
                            onChange={() => setMergePrimaryIds((current) => ({ ...current, [group.key]: item.id }))}
                          />
                          保留“{item.title}”
                        </label>
                      ))}
                    </CardContent>
                    <CardFooter>
                      <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void mergeDuplicateGroup(group.key, group.items)}>
                        <MergeIcon data-icon="inline-start" />
                        合并该组
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={DownloadIcon}
          title="加密备份与恢复"
          description="备份仍是端到端加密的 .vaultmesh 文件；恢复前会验证其主密码。"
          summary="保存新的加密备份，或从已有备份恢复保险库。"
          actionLabel="打开备份工具"
          fitDialogToContent
        >
          <Card size="sm">
            <CardHeader>
              <CardTitle>保存加密备份</CardTitle>
              <CardDescription>选择本地位置保存当前保险库的加密副本。</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => void run(async () => {
                  const result = await window.vaultMesh.vault.backup();
                  if (result.cancelled) throw new Error('已取消备份。');
                }, '加密备份已保存。')}
              >
                <DownloadIcon data-icon="inline-start" />
                保存加密备份
              </Button>
            </CardFooter>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>从备份恢复</CardTitle>
              <CardDescription>恢复会验证备份主密码，并关闭快速解锁。</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="restore-password">备份的主密码</FieldLabel>
                  <Input
                    id="restore-password"
                    type="password"
                    value={restorePassword}
                    minLength={8}
                    onChange={(event) => setRestorePassword(event.target.value)}
                  />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                disabled={busy || restorePassword.length < 8}
                onClick={() => void run(async () => {
                  const result = await window.vaultMesh.vault.restore({ masterPassword: restorePassword });
                  if (result.cancelled) throw new Error('已取消恢复。');
                  setRestorePassword('');
                  await refreshVault();
                  await reload();
                }, '保险库已从备份恢复，快速解锁已关闭。')}
              >
                <UploadIcon data-icon="inline-start" />
                选择备份并恢复
              </Button>
            </CardFooter>
          </Card>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={KeyRoundIcon}
          title="变更主密码"
          description="重新包装随机保险库密钥；所有凭据和历史保持不变。"
          summary="更新用于解锁本地保险库的主密码。"
          actionLabel="变更主密码"
        >
          <form onSubmit={(event) => void changePassword(event)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="current-master">当前主密码</FieldLabel>
                <Input
                  id="current-master"
                  type="password"
                  value={currentPassword}
                  minLength={8}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-master">新主密码</FieldLabel>
                <Input
                  id="new-master"
                  type="password"
                  value={newPassword}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>
              <Field data-invalid={confirmation.length > 0 && newPassword !== confirmation}>
                <FieldLabel htmlFor="confirm-master">确认新主密码</FieldLabel>
                <Input
                  id="confirm-master"
                  type="password"
                  value={confirmation}
                  minLength={8}
                  aria-invalid={confirmation.length > 0 && newPassword !== confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                disabled={busy || currentPassword.length < 8 || newPassword.length < 8}
              >
                <KeyRoundIcon data-icon="inline-start" />
                更新主密码
              </Button>
            </FieldGroup>
          </form>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={Trash2Icon}
          title="登录信息回收站"
          description="删除项仍在加密保险库中，可恢复；永久删除也会清除关联历史。"
          summary={`${trash.length} 条登录信息待处理`}
          actionLabel="管理回收站"
          footer={trash.length > 0 ? (
            <ConfirmAction
              triggerLabel="清空回收站"
              title="永久清空登录信息回收站？"
              description="回收站中的全部登录信息及其历史都会被永久清除，此操作无法撤销。"
              disabled={busy}
              onConfirm={() => run(async () => {
                await window.vaultMesh.items.emptyTrash();
                await reload();
              }, '回收站已清空。')}
            />
          ) : null}
        >
          <div className="flex flex-col gap-3">
            {trash.length === 0 ? (
              <EmptyState icon={Trash2Icon} title="回收站为空" description="删除的登录信息会显示在这里。" />
            ) : (
              trash.map((entry) => (
                <ItemCard key={entry.trashId} title={entry.title} description={formatTime(entry.deletedAt)}>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await window.vaultMesh.items.restoreTrash(entry.trashId);
                        await refreshVault();
                        await reload();
                      }, '登录信息已恢复。')}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      恢复
                    </Button>
                    <ConfirmAction
                      triggerLabel="永久删除"
                      title="永久删除这条登录信息？"
                      description="这条登录信息及其全部历史会被永久清除，此操作无法撤销。"
                      disabled={busy}
                      onConfirm={() => run(async () => {
                        await window.vaultMesh.items.purgeTrash(entry.trashId);
                        await reload();
                      }, '登录信息已永久删除。')}
                    />
                  </div>
                </ItemCard>
              ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={HistoryIcon}
          title="登录信息历史"
          description="仅显示版本元数据；历史中的密码与其他秘密不会传到界面。"
          summary={historyItemId ? `${history.length} 个历史版本` : '选择登录信息以查看历史'}
          actionLabel="查看项目历史"
          footer={history.length > 0 ? (
            <ConfirmAction
              triggerLabel="清除历史"
              title="清除此登录信息的全部历史？"
              description="全部历史版本都会被永久清除，此操作无法撤销。"
              disabled={busy}
              onConfirm={() => run(async () => {
                if (!historyItemId) return;
                await window.vaultMesh.items.clearHistory(historyItemId);
                setHistory([]);
              }, '历史已清除。')}
            />
          ) : null}
        >
          <Field>
            <FieldLabel htmlFor="login-history-select">登录信息</FieldLabel>
            <Select value={historyItemId} onValueChange={(value) => void loadHistory(value)}>
              <SelectTrigger id="login-history-select" className="w-full" disabled={items.length === 0}>
                <SelectValue placeholder="选择登录信息" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((item) => (
                    <SelectItem value={item.id} key={item.id}>{item.title}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-col gap-3">
            {history.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="暂无历史版本" description="所选登录信息还没有可恢复的历史。" />
            ) : (
              history.map((revision) => (
                <ItemCard key={revision.revisionId} title={revision.title} description={formatTime(revision.savedAt)}>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      await window.vaultMesh.items.restoreRevision(revision.itemId, revision.revisionId);
                      await refreshVault();
                      await loadHistory(revision.itemId);
                    }, '已恢复所选历史版本。')}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    恢复
                  </Button>
                </ItemCard>
              ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={CreditCardIcon}
          title="支付卡回收站"
          description="完整卡片仍位于加密载荷中，界面仅显示掩码。"
          summary={`${cardTrash.length} 张支付卡待处理`}
          actionLabel="管理卡片回收站"
          footer={cardTrash.length > 0 ? (
            <ConfirmAction
              triggerLabel="清空卡片回收站"
              title="永久清空支付卡回收站？"
              description="回收站中的全部支付卡及其历史都会被永久清除，此操作无法撤销。"
              disabled={busy}
              onConfirm={() => run(async () => {
                await window.vaultMesh.cards.emptyTrash();
                await reload();
              }, '支付卡回收站已清空。')}
            />
          ) : null}
        >
          <div className="flex flex-col gap-3">
            {cardTrash.length === 0 ? (
              <EmptyState icon={CreditCardIcon} title="回收站为空" description="删除的支付卡会显示在这里。" />
            ) : (
              cardTrash.map((entry) => (
                <ItemCard
                  key={entry.trashId}
                  title={entry.title}
                  description={`${entry.maskedNumber} · ${formatTime(entry.deletedAt)}`}
                >
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await window.vaultMesh.cards.restoreTrash(entry.trashId);
                        await refreshVault();
                        await reload();
                      }, '支付卡已恢复。')}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      恢复
                    </Button>
                    <ConfirmAction
                      triggerLabel="永久删除"
                      title="永久删除这张支付卡？"
                      description="这张支付卡及其全部历史会被永久清除，此操作无法撤销。"
                      disabled={busy}
                      onConfirm={() => run(async () => {
                        await window.vaultMesh.cards.purgeTrash(entry.trashId);
                        await reload();
                      }, '支付卡已永久删除。')}
                    />
                  </div>
                </ItemCard>
              ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={HistoryIcon}
          title="支付卡历史"
          description="卡号、安全码和 PIN 不会传到界面。"
          summary={cardHistoryItemId ? `${cardHistory.length} 个历史版本` : '选择支付卡以查看历史'}
          actionLabel="查看卡片历史"
          footer={cardHistory.length > 0 ? (
            <ConfirmAction
              triggerLabel="清除卡片历史"
              title="清除此支付卡的全部历史？"
              description="全部历史版本都会被永久清除，此操作无法撤销。"
              disabled={busy}
              onConfirm={() => run(async () => {
                if (!cardHistoryItemId) return;
                await window.vaultMesh.cards.clearHistory(cardHistoryItemId);
                setCardHistory([]);
              }, '支付卡历史已清除。')}
            />
          ) : null}
        >
          <Field>
            <FieldLabel htmlFor="card-history-select">支付卡</FieldLabel>
            <Select value={cardHistoryItemId} onValueChange={(value) => void loadCardHistory(value)}>
              <SelectTrigger id="card-history-select" className="w-full" disabled={cards.length === 0}>
                <SelectValue placeholder="选择支付卡" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {cards.map((card) => (
                    <SelectItem value={card.id} key={card.id}>{card.title}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-col gap-3">
            {cardHistory.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="暂无历史版本" description="所选支付卡还没有可恢复的历史。" />
            ) : (
              cardHistory.map((revision) => (
                <ItemCard
                  key={revision.revisionId}
                  title={revision.title}
                  description={`${revision.maskedNumber} · ${formatTime(revision.savedAt)}`}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      await window.vaultMesh.cards.restoreRevision(revision.itemId, revision.revisionId);
                      await refreshVault();
                      await loadCardHistory(revision.itemId);
                    }, '已恢复支付卡历史版本。')}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    恢复
                  </Button>
                </ItemCard>
              ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={TerminalIcon}
          title="SSH 凭据回收站"
          description="密码、私钥和口令始终留在加密载荷中。"
          summary={`${sshTrash.length} 条 SSH 凭据待处理`}
          actionLabel="管理 SSH 回收站"
          footer={sshTrash.length > 0 ? (
            <ConfirmAction
              triggerLabel="清空 SSH 回收站"
              title="永久清空 SSH 凭据回收站？"
              description="回收站中的全部 SSH 凭据及其历史都会被永久清除，此操作无法撤销。"
              disabled={busy}
              onConfirm={() => run(async () => {
                await window.vaultMesh.ssh.emptyTrash();
                await reload();
              }, 'SSH 凭据回收站已清空。')}
            />
          ) : null}
        >
          <div className="flex flex-col gap-3">
            {sshTrash.length === 0 ? (
              <EmptyState icon={TerminalIcon} title="回收站为空" description="删除的 SSH 凭据会显示在这里。" />
            ) : (
              sshTrash.map((entry) => (
                <ItemCard
                  key={entry.trashId}
                  title={entry.title}
                  description={`${entry.host ?? '未指定主机'} · ${formatTime(entry.deletedAt)}`}
                >
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await window.vaultMesh.ssh.restoreTrash(entry.trashId);
                        await refreshVault();
                        await reload();
                      }, 'SSH 凭据已恢复。')}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      恢复
                    </Button>
                    <ConfirmAction
                      triggerLabel="永久删除"
                      title="永久删除这条 SSH 凭据？"
                      description="这条 SSH 凭据及其全部历史会被永久清除，此操作无法撤销。"
                      disabled={busy}
                      onConfirm={() => run(async () => {
                        await window.vaultMesh.ssh.purgeTrash(entry.trashId);
                        await reload();
                      }, 'SSH 凭据已永久删除。')}
                    />
                  </div>
                </ItemCard>
              ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard
          icon={HistoryIcon}
          title="SSH 凭据历史"
          description="历史列表只显示名称与主机元数据。"
          summary={sshHistoryItemId ? `${sshHistory.length} 个历史版本` : '选择 SSH 凭据以查看历史'}
          actionLabel="查看 SSH 历史"
          footer={sshHistory.length > 0 ? (
            <ConfirmAction
              triggerLabel="清除 SSH 历史"
              title="清除此 SSH 凭据的全部历史？"
              description="全部历史版本都会被永久清除，此操作无法撤销。"
              disabled={busy}
              onConfirm={() => run(async () => {
                if (!sshHistoryItemId) return;
                await window.vaultMesh.ssh.clearHistory(sshHistoryItemId);
                setSshHistory([]);
              }, 'SSH 历史已清除。')}
            />
          ) : null}
        >
          <Field>
            <FieldLabel htmlFor="ssh-history-select">SSH 凭据</FieldLabel>
            <Select value={sshHistoryItemId} onValueChange={(value) => void loadSshHistory(value)}>
              <SelectTrigger id="ssh-history-select" className="w-full" disabled={sshCredentials.length === 0}>
                <SelectValue placeholder="选择 SSH 凭据" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sshCredentials.map((item) => (
                    <SelectItem value={item.id} key={item.id}>{item.title}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-col gap-3">
            {sshHistory.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="暂无历史版本" description="所选 SSH 凭据还没有可恢复的历史。" />
            ) : (
              sshHistory.map((revision) => (
                <ItemCard
                  key={revision.revisionId}
                  title={revision.title}
                  description={`${revision.host ?? '未指定主机'} · ${formatTime(revision.savedAt)}`}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      await window.vaultMesh.ssh.restoreRevision(revision.itemId, revision.revisionId);
                      await refreshVault();
                      await loadSshHistory(revision.itemId);
                    }, '已恢复 SSH 凭据历史版本。')}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    恢复
                  </Button>
                </ItemCard>
              ))
            )}
          </div>
        </SecurityFeatureCard>

        <SecurityFeatureCard icon={ContactIcon} title="身份回收站" description="完整身份资料保留在加密载荷中。" summary={`${identityTrash.length} 条身份待处理`} actionLabel="管理身份回收站" footer={identityTrash.length > 0 ? <ConfirmAction triggerLabel="清空身份回收站" title="永久清空身份回收站？" description="身份资料及其历史会被永久清除。" disabled={busy} onConfirm={() => run(async () => { await window.vaultMesh.identities.emptyTrash(); await reload(); }, '身份回收站已清空。')} /> : null}>
          <div className="flex flex-col gap-3">{identityTrash.length === 0 ? <EmptyState icon={ContactIcon} title="回收站为空" description="删除的身份会显示在这里。" /> : identityTrash.map((entry) => <ItemCard key={entry.trashId} title={entry.title} description={`${entry.displayName ?? '未填写姓名'} · ${formatTime(entry.deletedAt)}`}><div className="flex gap-2"><Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => void run(async () => { await window.vaultMesh.identities.restoreTrash(entry.trashId); await refreshVault(); await reload(); }, '身份已恢复。')}><RotateCcwIcon data-icon="inline-start" />恢复</Button><ConfirmAction triggerLabel="永久删除" title="永久删除这条身份？" description="身份资料及其历史会被永久清除。" disabled={busy} onConfirm={() => run(async () => { await window.vaultMesh.identities.purgeTrash(entry.trashId); await reload(); }, '身份已永久删除。')} /></div></ItemCard>)}</div>
        </SecurityFeatureCard>

        <SecurityFeatureCard icon={HistoryIcon} title="身份历史" description="历史列表只显示名称元数据。" summary={identityHistoryItemId ? `${identityHistory.length} 个历史版本` : '选择身份以查看历史'} actionLabel="查看身份历史" footer={identityHistory.length > 0 ? <ConfirmAction triggerLabel="清除历史" title="清除身份历史？" description="全部历史版本都会被永久清除。" disabled={busy} onConfirm={() => run(async () => { if (!identityHistoryItemId) return; await window.vaultMesh.identities.clearHistory(identityHistoryItemId); setIdentityHistory([]); }, '身份历史已清除。')} /> : null}>
          <Field><FieldLabel htmlFor="identity-history-select">身份</FieldLabel><Select value={identityHistoryItemId} onValueChange={(value) => void loadIdentityHistory(value)}><SelectTrigger id="identity-history-select" className="w-full" disabled={identities.length === 0}><SelectValue placeholder="选择身份" /></SelectTrigger><SelectContent><SelectGroup>{identities.map((item) => <SelectItem value={item.id} key={item.id}>{item.title}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <div className="flex flex-col gap-3">{identityHistory.length === 0 ? <EmptyState icon={HistoryIcon} title="暂无历史版本" description="所选身份还没有可恢复的历史。" /> : identityHistory.map((revision) => <ItemCard key={revision.revisionId} title={revision.title} description={`${revision.displayName ?? '未填写姓名'} · ${formatTime(revision.savedAt)}`}><Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => void run(async () => { await window.vaultMesh.identities.restoreRevision(revision.itemId, revision.revisionId); await refreshVault(); await loadIdentityHistory(revision.itemId); }, '已恢复身份历史版本。')}><RotateCcwIcon data-icon="inline-start" />恢复</Button></ItemCard>)}</div>
        </SecurityFeatureCard>
  </>;
}
