// @ts-nocheck
import { ipcBridge } from '@/common';
import type { ITeamGroupDelivery, ITeamGroupMessage, TeamAssistant } from '@/common/types/team/teamTypes';
import type { TeamRunViewState } from '../../hooks/useTeamRunView';
import type { TeamWarmupPhase } from '../../hooks/useTeamWarmup';
import { Avatar, Button, Checkbox, Empty, Input, Message, Popover, Spin, Tag } from '@arco-design/web-react';
import { AtSign, Communication, FileText, Paperclip, Peoples, Send } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveMentionTargets } from './mentionRouting';
import PromptLibraryPicker from '@/renderer/components/chat/SendBox/PromptLibraryPicker';
import PromptEnhancementActions from '@/renderer/components/chat/SendBox/PromptEnhancementActions';
import type { PromptEnhancementTeamMember } from '@/common/types/agent/promptEnhancement';
import { insertPromptText } from '@/renderer/hooks/config/promptLibraryModel';
import TeamMaterialsPanel from './TeamMaterialsPanel';
import TeamGroupRuntimeControls from './TeamGroupRuntimeControls';
import GroupReadinessBar from './GroupReadinessBar';
import GroupDispatchBoard from './GroupDispatchBoard';
export { default as TeamContactsPanel } from './TeamContactsPanel';

type Props = {
  team_id: string;
  assistants: TeamAssistant[];
  workspacePath?: string;
  sessionMode?: string;
  onOpenPrivateChat: (slot_id: string) => void;
  /** Apply private-chat-equivalent run acks so queue/busy UI stays live after group dispatch. */
  onTeamRunAck?: (ack: NonNullable<ITeamGroupDelivery['ack']>) => void;
  runView?: TeamRunViewState;
  warmupPhase?: TeamWarmupPhase;
  onRetryWarmup?: () => void;
};

const mergeMessages = (current: ITeamGroupMessage[], incoming: ITeamGroupMessage[]): ITeamGroupMessage[] => {
  const byId = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => byId.set(message.id, message));
  return [...byId.values()].toSorted(
    (left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id)
  );
};

const deliveryChipStatus = (delivery: ITeamGroupDelivery | undefined): 'default' | 'warning' | 'danger' | 'success' => {
  if (!delivery) return 'default';
  if (delivery.delivered === false || delivery.error) return 'danger';
  const enqueue = delivery.enqueue_status ?? delivery.ack?.enqueue_status;
  if (enqueue === 'queued' || enqueue === 'blocked_runtime_starting') return 'warning';
  if (delivery.delivered) return 'success';
  return 'default';
};

const deliveryChipSuffix = (
  delivery: ITeamGroupDelivery | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  if (!delivery) return '';
  if (delivery.delivered === false || delivery.error) {
    return ` · ${t('team.groupChat.deliveryStatus.failed', { defaultValue: 'failed' })}`;
  }
  const enqueue = delivery.enqueue_status ?? delivery.ack?.enqueue_status;
  if (enqueue === 'queued') {
    return ` · ${t('team.groupChat.deliveryStatus.queued', { defaultValue: 'queued' })}`;
  }
  if (enqueue === 'blocked_runtime_starting') {
    return ` · ${t('team.groupChat.deliveryStatus.starting', { defaultValue: 'starting' })}`;
  }
  if (enqueue === 'accepted' || delivery.delivered) {
    return ` · ${t('team.groupChat.deliveryStatus.accepted', { defaultValue: 'accepted' })}`;
  }
  return '';
};

const emptyRunView: TeamRunViewState = {
  hydrated: false,
  activeRun: undefined,
  childTurnsBySlot: {},
  slotWorkBySlot: {},
  sessionStopped: false,
};

const TeamGroupChat: React.FC<Props> = ({
  team_id,
  assistants,
  workspacePath,
  sessionMode,
  onOpenPrivateChat,
  onTeamRunAck,
  runView = emptyRunView,
  warmupPhase = 'ready',
  onRetryWarmup,
}) => {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<ITeamGroupMessage[]>([]);
  const [deliveriesByMessage, setDeliveriesByMessage] = useState<Record<string, ITeamGroupDelivery[]>>({});
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(() => new Set());
  const [mentionEveryone, setMentionEveryone] = useState(false);
  const [mentionVisible, setMentionVisible] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const promptSelectionRef = useRef({ start: 0, end: 0, available: false });

  const assistantBySlot = useMemo(
    () => new Map(assistants.map((assistant) => [assistant.slot_id, assistant])),
    [assistants]
  );
  const leader = assistants.find((assistant) => assistant.role === 'leader');
  const targetSlotIds = useMemo(
    () => resolveMentionTargets(assistants, selectedSlotIds, mentionEveryone),
    [assistants, mentionEveryone, selectedSlotIds]
  );
  const enhancementTeamMembers = useMemo<PromptEnhancementTeamMember[]>(
    () =>
      assistants.map((assistant) => ({
        name: assistant.assistant_name,
        role: assistant.role,
        backend: assistant.assistant_backend,
        model: assistant.model,
        status: assistant.status,
        targeted: targetSlotIds.includes(assistant.slot_id),
      })),
    [assistants, targetSlotIds]
  );
  const sharedFiles = useMemo(() => [...new Set(messages.flatMap((message) => message.files ?? []))], [messages]);

  // Deliveries come from three sources merged by message id: seeded from the
  // history list, upserted from `groupMessageCreated` broadcasts (the second
  // broadcast for a message id carries deliveries), and written directly from
  // the send response (which additionally carries the full ack).
  const absorbDeliveries = useCallback(
    (incoming: ITeamGroupMessage[]) => {
      const acks: NonNullable<ITeamGroupDelivery['ack']>[] = [];
      setDeliveriesByMessage((current) => {
        let next = current;
        for (const message of incoming) {
          if (!message.deliveries?.length) continue;
          if (next === current) next = { ...current };
          next[message.id] = message.deliveries;
          for (const delivery of message.deliveries) {
            if (delivery.ack) acks.push(delivery.ack);
          }
        }
        return next;
      });
      for (const ack of acks) onTeamRunAck?.(ack);
    },
    [onTeamRunAck]
  );

  const selectMaterials = useCallback(async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const selected = await ipcBridge.dialog.showOpen.invoke({ properties: ['openFile', 'multiSelections'] });
      if (!selected?.length) return;
      const files = workspacePath
        ? (
            await ipcBridge.fs.copyFilesToWorkspace.invoke({
              file_paths: selected,
              workspace: workspacePath,
            })
          ).copied_files
        : selected;
      if (files.length === 0) {
        Message.error(t('team.groupChat.uploadFailed'));
        return;
      }
      const response = await ipcBridge.team.sendGroupMessage.invoke({
        team_id,
        input: t('team.groupChat.sharedFilesMessage', { count: files.length }),
        files,
        share_only: true,
        target_slot_ids: [],
      });
      setMessages((current) => mergeMessages(current, [response.message]));
      if (files.length < selected.length) Message.warning(t('team.groupChat.uploadPartial'));
    } catch {
      Message.error(t('team.groupChat.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }, [t, team_id, uploading, workspacePath]);

  const selectAttachments = useCallback(async () => {
    if (attaching) return;
    setAttaching(true);
    try {
      const selected = await ipcBridge.dialog.showOpen.invoke({ properties: ['openFile', 'multiSelections'] });
      if (!selected?.length) return;
      const files = workspacePath
        ? (
            await ipcBridge.fs.copyFilesToWorkspace.invoke({
              file_paths: selected,
              workspace: workspacePath,
            })
          ).copied_files
        : selected;
      if (files.length === 0) {
        Message.error(t('team.groupChat.uploadFailed'));
        return;
      }
      setAttachments((current) => [...new Set([...current, ...files])]);
      if (files.length < selected.length) Message.warning(t('team.groupChat.uploadPartial'));
    } catch {
      Message.error(t('team.groupChat.uploadFailed'));
    } finally {
      setAttaching(false);
    }
  }, [attaching, t, workspacePath]);

  const openMaterial = useCallback(
    (file_path: string): void => {
      void ipcBridge.shell.openFile.invoke(file_path).catch(() => Message.error(t('common.unknownError')));
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let loadFailureReported = false;
    setLoading(true);
    const loadMessages = (): void => {
      ipcBridge.team.listGroupMessages
        .invoke({ team_id })
        .then((response) => {
          if (cancelled) return;
          setMessages((current) => mergeMessages(current, response.messages));
          absorbDeliveries(response.messages);
        })
        .catch(() => {
          if (cancelled) return;
          if (!loadFailureReported) {
            loadFailureReported = true;
            Message.error(t('team.groupChat.loadFailed'));
          }
          retryTimer = setTimeout(loadMessages, 1_000);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    loadMessages();

    const unsubscribe = ipcBridge.team.groupMessageCreated.on((message) => {
      if (message.team_id !== team_id || cancelled) return;
      setMessages((current) => mergeMessages(current, [message]));
      absorbDeliveries([message]);
    });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [absorbDeliveries, t, team_id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const activeSlots = new Set(assistants.map((assistant) => assistant.slot_id));
    setSelectedSlotIds((current) => new Set([...current].filter((slotId) => activeSlots.has(slotId))));
  }, [assistants]);

  const toggleSlot = useCallback((slot_id: string, checked: boolean) => {
    setMentionEveryone(false);
    setSelectedSlotIds((current) => {
      const next = new Set(current);
      if (checked) next.add(slot_id);
      else next.delete(slot_id);
      return next;
    });
    if (checked) {
      setMentionVisible(false);
      setInput((current) => (current.endsWith('@') ? current.slice(0, -1) : current));
    }
  }, []);

  const toggleEveryone = useCallback((checked: boolean) => {
    setMentionEveryone(checked);
    if (checked) {
      setSelectedSlotIds(new Set());
      setMentionVisible(false);
      setInput((current) => (current.endsWith('@') ? current.slice(0, -1) : current));
    }
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    if (value.endsWith('@')) setMentionVisible(true);
  }, []);

  const rememberPromptSelection = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLTextAreaElement)) return;
    promptSelectionRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
      available: true,
    };
  }, []);

  const insertPrompt = useCallback(
    (prompt: { content: string }) => {
      const selection = promptSelectionRef.current;
      const inserted = insertPromptText(
        input,
        prompt.content,
        selection.available ? selection.start : undefined,
        selection.available ? selection.end : undefined
      );
      setInput(inserted.value);
      promptSelectionRef.current = { start: inserted.caret, end: inserted.caret, available: true };
      requestAnimationFrame(() => {
        const textarea = composerRef.current?.querySelector('textarea');
        if (!(textarea instanceof HTMLTextAreaElement)) return;
        textarea.focus();
        textarea.setSelectionRange(inserted.caret, inserted.caret);
      });
    },
    [input]
  );

  const stopDispatchTarget = useCallback(
    async ({ slot_id, team_run_id }: { slot_id: string; team_run_id: string }) => {
      try {
        await ipcBridge.team.pauseSlotWork.invoke({
          team_id,
          team_run_id,
          slot_id,
          reason: 'user_stop',
        });
      } catch (error) {
        console.warn('[TeamGroupChat] pause dispatch target failed', error);
        Message.error(t('team.groupChat.dispatch.stopFailed', { defaultValue: 'Failed to stop this member.' }));
      }
    },
    [t, team_id]
  );

  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && attachments.length === 0) || sending) return;
    if (warmupPhase === 'warming') {
      Message.info(
        t('team.groupChat.readiness.warmingSend', {
          defaultValue: 'Session is still starting — message may queue until members are ready.',
        })
      );
    }
    const content = trimmedInput || t('team.groupChat.sharedFilesMessage', { count: attachments.length });
    // Empty @ selection must explicitly target the leader — never rely on backend default of [].
    const resolvedTargetSlotIds = targetSlotIds.length > 0 ? targetSlotIds : leader?.slot_id ? [leader.slot_id] : [];
    setSending(true);
    try {
      const response = await ipcBridge.team.sendGroupMessage.invoke({
        team_id,
        input: content,
        // Only attach files selected for this send — never re-broadcast historical materials.
        files: attachments.length > 0 ? attachments : undefined,
        target_slot_ids: resolvedTargetSlotIds,
      });
      setMessages((current) => mergeMessages(current, [response.message]));
      setDeliveriesByMessage((current) => ({ ...current, [response.message.id]: response.deliveries }));
      for (const delivery of response.deliveries) {
        if (delivery.ack) onTeamRunAck?.(delivery.ack);
      }
      setInput('');
      setAttachments([]);
      setSelectedSlotIds(new Set());
      setMentionEveryone(false);
      if (response.deliveries.some((delivery) => !delivery.delivered)) {
        Message.warning(t('team.groupChat.deliveryFailed'));
      } else if (
        response.deliveries.some((delivery) => {
          const enqueue = delivery.enqueue_status ?? delivery.ack?.enqueue_status;
          return enqueue === 'queued' || enqueue === 'blocked_runtime_starting';
        })
      ) {
        Message.info(
          t('team.groupChat.deliveryQueued', {
            defaultValue: 'Message accepted; some members are still queued or starting.',
          })
        );
      }
    } catch {
      Message.error(t('team.groupChat.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [attachments, input, leader?.slot_id, onTeamRunAck, sending, t, targetSlotIds, team_id, warmupPhase]);

  const mentionContent = (
    <div className='w-240px max-h-300px overflow-y-auto py-4px' data-testid='team-group-mention-menu'>
      <div className='px-8px py-6px border-b border-solid border-[color:var(--border-base)]'>
        <Checkbox checked={mentionEveryone} onChange={toggleEveryone}>
          <span className='font-medium'>{t('team.groupChat.everyone')}</span>
        </Checkbox>
      </div>
      <div className='flex flex-col gap-2px pt-4px'>
        {assistants.map((assistant) => (
          <div key={assistant.slot_id} className='px-8px py-5px hover:bg-2 rd-4px'>
            <Checkbox
              checked={mentionEveryone || selectedSlotIds.has(assistant.slot_id)}
              disabled={mentionEveryone}
              onChange={(checked) => toggleSlot(assistant.slot_id, checked)}
            >
              <span>{assistant.assistant_name}</span>
              {assistant.role === 'leader' && (
                <span className='ml-6px text-12px text-t-secondary'>({t('team.create.currentLeader')})</span>
              )}
            </Checkbox>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className='flex h-full w-full flex-col bg-1' data-testid='team-group-chat'>
      <GroupReadinessBar phase={warmupPhase} sessionStopped={runView.sessionStopped} onRetry={onRetryWarmup} />
      <TeamMaterialsPanel files={sharedFiles} uploading={uploading} onUpload={selectMaterials} onOpen={openMaterial} />
      <div className='flex-1 overflow-y-auto px-20px py-18px'>
        <div className='mx-auto flex min-h-full w-full max-w-860px flex-col'>
          {loading ? (
            <div className='flex flex-1 items-center justify-center'>
              <Spin loading tip={t('team.groupChat.loading')} />
            </div>
          ) : messages.length === 0 ? (
            <div className='flex flex-1 items-center justify-center'>
              <Empty
                icon={<Peoples theme='outline' size='44' fill='currentColor' />}
                description={
                  <div className='text-center'>
                    <div className='text-14px font-medium text-t-primary'>{t('team.groupChat.emptyTitle')}</div>
                    <div className='mt-4px text-12px text-t-secondary'>{t('team.groupChat.emptyHint')}</div>
                  </div>
                }
              />
            </div>
          ) : (
            <div className='flex flex-col gap-18px'>
              {messages.map((message) => {
                const isUser = message.kind === 'user';
                const sender = message.sender_slot_id ? assistantBySlot.get(message.sender_slot_id) : undefined;
                const deliveries = deliveriesByMessage[message.id];
                return (
                  <div
                    key={message.id}
                    data-testid={`team-group-message-${message.id}`}
                    className={`flex gap-10px ${isUser ? 'flex-row-reverse' : ''}`}
                  >
                    <Avatar size={34} className='shrink-0 !bg-3 !text-t-primary'>
                      {(isUser ? t('team.groupChat.you') : message.sender_name || sender?.assistant_name || '?').slice(
                        0,
                        1
                      )}
                    </Avatar>
                    <div className={`min-w-0 max-w-[76%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className='mb-4px flex items-center gap-8px text-12px text-t-secondary'>
                        <span>{isUser ? t('team.groupChat.you') : message.sender_name || sender?.assistant_name}</span>
                        <span>
                          {new Intl.DateTimeFormat(i18n.language, {
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(message.created_at)}
                        </span>
                      </div>
                      <div
                        className={`rd-6px px-13px py-9px text-14px whitespace-pre-wrap break-words ${
                          isUser ? 'bg-brand text-white' : 'bg-2 text-t-primary'
                        }`}
                      >
                        {message.content}
                      </div>
                      {!!message.files?.length && (
                        <div className={`mt-6px flex flex-wrap gap-5px ${isUser ? 'justify-end' : ''}`}>
                          {message.files.map((file_path) => (
                            <Button
                              key={file_path}
                              type='secondary'
                              size='mini'
                              icon={<FileText theme='outline' size='13' fill='currentColor' />}
                              title={t('team.groupChat.openMaterial')}
                              onClick={() => openMaterial(file_path)}
                            >
                              {file_path.split(/[/\\]/).pop() || file_path}
                            </Button>
                          ))}
                        </div>
                      )}
                      {(message.kind === 'user' || message.target_slot_ids.length > 0) && (
                        <div className={`mt-6px flex flex-wrap items-center gap-5px ${isUser ? 'justify-end' : ''}`}>
                          <span className='text-12px text-t-secondary'>
                            {message.kind === 'agent'
                              ? t('team.groupChat.leaderDelegated')
                              : t('team.groupChat.sentTo')}
                          </span>
                          {message.target_slot_ids.map((slot_id) => {
                            const target = assistantBySlot.get(slot_id);
                            const delivery = deliveries?.find((item) => item.slot_id === slot_id);
                            const suffix = deliveryChipSuffix(delivery, t);
                            const chipTitle = delivery?.error
                              ? delivery.error
                              : `${t('team.groupChat.viewReply')}${suffix}`;
                            return (
                              <Button
                                key={slot_id}
                                type='text'
                                size='mini'
                                status={deliveryChipStatus(delivery)}
                                icon={<Communication theme='outline' size='13' fill='currentColor' />}
                                title={chipTitle}
                                data-testid={`team-group-delivery-${message.id}-${slot_id}`}
                                data-enqueue-status={
                                  delivery?.enqueue_status ?? delivery?.ack?.enqueue_status ?? undefined
                                }
                                onClick={() => onOpenPrivateChat(slot_id)}
                                className='!h-22px !px-5px'
                              >
                                {`${target?.assistant_name ?? slot_id}${suffix}`}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                      {message.kind === 'user' && message.target_slot_ids.length > 0 ? (
                        <GroupDispatchBoard
                          messageId={message.id}
                          targetSlotIds={message.target_slot_ids}
                          deliveries={deliveries}
                          assistantsBySlot={assistantBySlot}
                          runView={runView}
                          sentAt={message.created_at}
                          onOpenPrivateChat={onOpenPrivateChat}
                          onStopTarget={stopDispatchTarget}
                          onRetryWarmup={onRetryWarmup}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>

      <div className='shrink-0 border-t border-solid border-[color:var(--border-base)] bg-1 px-20px py-14px'>
        <div className='mx-auto w-full max-w-860px'>
          <div className='mb-8px flex min-h-24px flex-wrap items-center gap-6px'>
            {targetSlotIds.length === 0 ? (
              <Tag color='gray'>{t('team.groupChat.defaultLeader', { name: leader?.assistant_name })}</Tag>
            ) : mentionEveryone ? (
              <Tag color='arcoblue'>@{t('team.groupChat.everyone')}</Tag>
            ) : (
              targetSlotIds.map((slot_id) => (
                <Tag key={slot_id} color='arcoblue' closable onClose={() => toggleSlot(slot_id, false)}>
                  @{assistantBySlot.get(slot_id)?.assistant_name ?? slot_id}
                </Tag>
              ))
            )}
          </div>
          <div
            ref={composerRef}
            className='relative rd-6px border border-solid border-[color:var(--border-base)] bg-1 px-12px py-10px focus-within:border-[color:var(--primary)]'
          >
            <Input.TextArea
              value={input}
              onChange={handleInputChange}
              placeholder={t('team.groupChat.placeholder')}
              autoSize={{ minRows: 1, maxRows: 5 }}
              disabled={sending}
              onClick={(event) => rememberPromptSelection(event.currentTarget)}
              onKeyUp={(event) => rememberPromptSelection(event.currentTarget)}
              onSelect={(event) => rememberPromptSelection(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && mentionVisible) {
                  event.preventDefault();
                  setMentionVisible(false);
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
            />
            {attachments.length > 0 && (
              <div
                className='mt-8px flex min-w-0 flex-wrap items-center gap-6px'
                data-testid='team-group-pending-attachments'
              >
                <span className='text-12px text-t-secondary'>{t('team.groupChat.attachedFiles')}</span>
                {attachments.map((file_path) => (
                  <Tag
                    key={file_path}
                    closable
                    title={t('team.groupChat.removeAttachment')}
                    onClose={() => setAttachments((current) => current.filter((item) => item !== file_path))}
                  >
                    {file_path.split(/[/\\]/).pop() || file_path}
                  </Tag>
                ))}
              </div>
            )}
            <div className='mt-8px flex min-w-0 items-center justify-between gap-8px'>
              <div className='flex min-w-0 flex-wrap items-center gap-8px'>
                <Popover
                  content={mentionContent}
                  trigger='click'
                  position='tl'
                  popupVisible={mentionVisible}
                  onVisibleChange={setMentionVisible}
                >
                  <Button
                    type='outline'
                    shape='circle'
                    icon={<AtSign theme='outline' size='18' fill='currentColor' />}
                    aria-label={t('team.groupChat.mention')}
                    title={t('team.groupChat.mention')}
                  />
                </Popover>
                <Button
                  type='outline'
                  shape='circle'
                  icon={<Paperclip theme='outline' size='18' fill='currentColor' />}
                  loading={attaching}
                  disabled={sending}
                  aria-label={t('team.groupChat.attachedFiles')}
                  title={t('team.groupChat.attachedFiles')}
                  onClick={() => void selectAttachments()}
                />
                <PromptLibraryPicker onInsert={insertPrompt} disabled={sending} />
                <PromptEnhancementActions
                  value={input}
                  onChange={setInput}
                  workspace={workspacePath}
                  conversationId={leader?.conversation_id}
                  teamMembers={enhancementTeamMembers}
                  disabled={sending}
                  onApplied={() => {
                    const textarea = composerRef.current?.querySelector('textarea');
                    if (!(textarea instanceof HTMLTextAreaElement)) return;
                    textarea.focus();
                    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                  }}
                />
                <TeamGroupRuntimeControls leader={leader} sessionMode={sessionMode} />
              </div>
              <Button
                type='primary'
                shape='circle'
                icon={<Send theme='outline' size='18' fill='currentColor' />}
                loading={sending}
                disabled={!input.trim() && attachments.length === 0}
                aria-label={t('team.groupChat.send')}
                title={t('team.groupChat.send')}
                onClick={() => void sendMessage()}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamGroupChat;
