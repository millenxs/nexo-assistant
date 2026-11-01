'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  ArrowUp,
  ArrowUpRight,
  Bot,
  CheckCheck,
  ChevronRight,
  EllipsisVertical,
  Hand,
  Headset,
  LogOut,
  MessageCircle,
  Search,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  Analyst,
  Conversation,
  DecisionTrace,
  Message,
  Ticket,
} from '@/domain/types';
import { NexoMark } from './NexoMark';
import { DecisionInspectorDrawer } from './DecisionInspectorDrawer';

type ConsoleConversationItem = Conversation & {
  lastMessagePreview: string;
  lastMessageSenderType: Message['senderType'];
  lastMessageTimeLabel: string;
};

export function AnalystConsole({
  analyst,
  onBackToEmployeeView,
  onLogout,
}: {
  analyst: Analyst;
  onBackToEmployeeView: () => void;
  onLogout: () => void;
}) {
  const [conversations, setConversations] = useState<ConsoleConversationItem[]>([]);
  const [counts, setCounts] = useState({ all: 0, forYou: 0, withAgent: 0, mine: 0 });
  const [selectedConvId, setSelectedConvId] = useState<string>('conv-ana');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [employeeTickets, setEmployeeTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<'all' | 'forYou' | 'withAgent' | 'mine'>('forYou');
  const [searchQuery, setSearchQuery] = useState('');
  const [analystInput, setAnalystInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTicketPanel, setShowTicketPanel] = useState(true);
  const [selectedModalTicket, setSelectedModalTicket] = useState<Ticket | null>(null);
  const [inspectedTrace, setInspectedTrace] = useState<DecisionTrace | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const fetchConsoleData = async (convId = selectedConvId) => {
    try {
      const res = await fetch(
        `/api/analyst?analystId=${encodeURIComponent(analyst.id)}&conversationId=${encodeURIComponent(convId)}`
      );
      const data = await res.json();
      if (res.ok) {
        setConversations(data.conversations || []);
        setCounts(data.counts || { all: 0, forYou: 0, withAgent: 0, mine: 0 });
        setActiveConversation(data.activeConversation || null);
        setMessages(data.messages || []);
        setEmployeeTickets(data.employeeTickets || []);
      }
    } catch {
      // ignore transient polling error
    }
  };

  useEffect(() => {
    fetchConsoleData(selectedConvId);
    const interval = setInterval(() => {
      fetchConsoleData(selectedConvId);
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedConvId, analyst.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedConvId]);

  const handleAnalystAction = async (
    action: 'takeover' | 'message' | 'return-to-agent' | 'close',
    customContent?: string
  ) => {
    if (!activeConversation || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/analyst', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          conversationId: activeConversation.id,
          analystId: analyst.id,
          content: customContent ?? analystInput,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (action === 'message') setAnalystInput('');
        setConversations(data.conversations || []);
        setCounts(data.counts || counts);
        setActiveConversation(data.activeConversation || null);
        setMessages(data.messages || []);
        setEmployeeTickets(data.employeeTickets || []);
      }
    } finally {
      setBusy(false);
    }
  };

  const filteredConversations = conversations.filter((c) => {
    if (filter === 'forYou' && c.status !== 'WAITING_ANALYST') return false;
    if (filter === 'withAgent' && c.status !== 'ACTIVE_WITH_AGENT') return false;
    if (filter === 'mine' && c.status !== 'WITH_ANALYST') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        c.employeeName.toLowerCase().includes(q) ||
        c.employeeDepartment.toLowerCase().includes(q) ||
        (c.activeTicketNumber?.toLowerCase().includes(q) ?? false) ||
        c.listTagLabel.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const firstName = activeConversation?.employeeName.split(' ')[0] ?? 'Cliente';
  const currentTicket =
    employeeTickets.find((t) => t.number === activeConversation?.activeTicketNumber) ??
    employeeTickets[0] ??
    null;
  const otherTickets = employeeTickets.filter((t) => t.number !== currentTicket?.number);
  const openTicketsCount = employeeTickets.filter((t) => t.status !== 'Resolvido').length;
  const closedTicketsCount = employeeTickets.filter((t) => t.status === 'Resolvido').length;

  return (
    <div className="h-screen w-full bg-[var(--paper)] flex overflow-hidden">
      {/* 1. Left Rail (64px width per nexo.pen) */}
      <aside className="w-16 shrink-0 h-full bg-[var(--desk)] border-r border-[var(--rule)] py-4 flex flex-col items-center gap-2">
        <div className="w-10 h-10 flex items-center justify-center pb-2">
          <NexoMark size={22} color="#037AF6" />
        </div>

        {/* Conversas Icon with Unread Badge */}
        <div className="relative w-10 h-10 rounded-[12px] bg-[var(--paper)] flex items-center justify-center shadow-xs">
          <MessageCircle className="w-[19px] h-[19px] text-[var(--ink)]" />
          <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[var(--cta)] border-2 border-[var(--desk)] text-[10px] font-bold text-white flex items-center justify-center">
            {counts.forYou + counts.mine}
          </span>
        </div>

        {/* Switch to Employee View Button */}
        <button
          type="button"
          onClick={onBackToEmployeeView}
          title="Alternar para visão do Funcionário (Chat Nexo Assist)"
          className="mt-2 w-10 h-10 rounded-[12px] hover:bg-[var(--paper)] flex items-center justify-center text-[var(--ink-2)] transition-colors cursor-pointer"
        >
          <UserRound className="w-[18px] h-[18px]" />
        </button>

        <div className="flex-1" />

        {/* Analyst Avatar (RL) */}
        <div
          className="relative w-9 h-9 rounded-full bg-[var(--primary-soft)] flex items-center justify-center"
          title={`${analyst.name} (${analyst.tier})`}
        >
          <span className="text-[12.5px] font-bold text-[var(--primary-text)]">
            {analyst.initials}
          </span>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[var(--success)] border-2 border-[var(--desk)]" />
        </div>

        <button
          type="button"
          onClick={onLogout}
          title="Sair"
          className="w-9 h-9 rounded-lg hover:bg-[var(--paper)] flex items-center justify-center text-[var(--ink-3)] cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </aside>

      {/* 2. Chat List Column (380px width per nexo.pen) */}
      <section className="w-[380px] shrink-0 h-full border-r border-[var(--rule)] flex flex-col bg-[var(--paper)]">
        {/* Header */}
        <div className="px-4 pt-4 pb-2.5 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-[20px] font-bold tracking-[-0.3px] text-[var(--ink)]">
              Conversas
            </h1>
            <div className="px-2.5 py-[5px] rounded-full bg-[var(--success-soft)] flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full bg-[var(--success)]" />
              <span className="text-[12.5px] font-semibold text-[var(--success-text)]">
                Disponível
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="h-9 px-3 rounded-full bg-[var(--desk)] flex items-center gap-2.5">
            <Search className="w-[15px] h-[15px] text-[var(--ink-3)] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar conversa ou chamado"
              className="w-full text-[13.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)] bg-transparent focus:outline-none"
            />
          </div>

          {/* 4 Filter Tabs from nexo.pen */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1.5 rounded-full text-[12.5px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === 'all'
                  ? 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
                  : 'bg-[var(--desk)] text-[var(--ink-2)] hover:bg-[#1B24310D]'
              }`}
            >
              <span>Todas</span>
              <span className="font-semibold">{counts.all}</span>
            </button>

            <button
              type="button"
              onClick={() => setFilter('forYou')}
              className={`px-2.5 py-1.5 rounded-full text-[12.5px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === 'forYou'
                  ? 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
                  : 'bg-[var(--desk)] text-[var(--ink-2)] hover:bg-[#1B24310D]'
              }`}
            >
              <span>Para você</span>
              <span className="font-semibold">{counts.forYou}</span>
            </button>

            <button
              type="button"
              onClick={() => setFilter('withAgent')}
              className={`px-2.5 py-1.5 rounded-full text-[12.5px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === 'withAgent'
                  ? 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
                  : 'bg-[var(--desk)] text-[var(--ink-2)] hover:bg-[#1B24310D]'
              }`}
            >
              <span>Com o agent</span>
              <span className="font-semibold">{counts.withAgent}</span>
            </button>

            <button
              type="button"
              onClick={() => setFilter('mine')}
              className={`px-2.5 py-1.5 rounded-full text-[12.5px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                filter === 'mine'
                  ? 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
                  : 'bg-[var(--desk)] text-[var(--ink-2)] hover:bg-[#1B24310D]'
              }`}
            >
              <span>Minhas</span>
              <span className="font-semibold">{counts.mine}</span>
            </button>
          </div>
        </div>

        {/* Conversation Items List */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {filteredConversations.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-2">
              <div className="text-[13.5px] text-[var(--ink-3)]">
                Nenhuma conversa neste filtro.
              </div>
              {filter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className="text-[12.5px] font-semibold text-[var(--primary-text)] hover:underline cursor-pointer"
                >
                  Ver todas as conversas ({counts.all})
                </button>
              )}
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isSelected = c.id === activeConversation?.id;
              const tagDot =
                c.listTagTone === 'danger'
                  ? 'bg-[var(--danger)]'
                  : c.listTagTone === 'warning'
                    ? 'bg-[var(--warning)]'
                    : c.listTagTone === 'primary'
                      ? 'bg-[var(--primary)]'
                      : c.listTagTone === 'success'
                        ? 'bg-[var(--success)]'
                        : 'bg-[#1B243155]';

              const tagText =
                c.listTagTone === 'danger'
                  ? 'text-[var(--danger-text)]'
                  : c.listTagTone === 'warning'
                    ? 'text-[var(--warning-text)]'
                    : c.listTagTone === 'primary'
                      ? 'text-[var(--primary-text)]'
                      : 'text-[var(--ink-3)]';

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedConvId(c.id)}
                  className={`w-full p-2.5 rounded-[12px] flex items-center gap-3 text-left transition-colors cursor-pointer ${
                    isSelected ? 'bg-[var(--desk)]' : 'hover:bg-[#1B243106]'
                  }`}
                >
                  {/* Avatar 46x46 */}
                  <div
                    className="relative w-[46px] h-[46px] rounded-full flex items-center justify-center shrink-0"
                    style={{ backgroundColor: c.employeeAvatarBg }}
                  >
                    <span
                      className="text-[15.5px] font-semibold"
                      style={{ color: c.employeeAvatarFg }}
                    >
                      {c.employeeInitials}
                    </span>
                    {c.employeeOnline && (
                      <span className="absolute bottom-0 right-0 w-[11px] h-[11px] rounded-full bg-[var(--success)] border-2 border-[var(--paper)]" />
                    )}
                  </div>

                  {/* Text block */}
                  <div className="flex-1 min-w-0 border-b border-[var(--rule)] pb-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold text-[var(--ink)] truncate">
                        {c.employeeName}
                      </span>
                      <span
                        className={`text-[12px] shrink-0 ${
                          c.unreadForAnalyst > 0
                            ? 'font-semibold text-[var(--cta)]'
                            : 'text-[var(--ink-3)]'
                        }`}
                      >
                        {c.lastMessageTimeLabel}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        {c.lastMessageSenderType !== 'employee' && (
                          <CheckCheck className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
                        )}
                        <span className="text-[13px] text-[var(--ink-3)] truncate">
                          {c.lastMessagePreview}
                        </span>
                      </div>
                      {c.unreadForAnalyst > 0 && (
                        <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-[var(--cta)] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                          {c.unreadForAnalyst}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${tagDot}`} />
                      <span className={`text-[11.5px] font-medium ${tagText}`}>
                        {c.listTagLabel}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* 3. Center Conversation Column (fill=#EEF1F5 per nexo.pen) */}
      <section className="flex-1 h-full flex flex-col min-w-0 bg-[var(--console-canvas)]">
        {activeConversation ? (
          <>
            {/* Conversation Header (64px height, fill=$paper) */}
            <header className="h-16 px-5 bg-[var(--paper)] border-b border-[var(--rule)] flex items-center gap-3 shrink-0">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: activeConversation.employeeAvatarBg }}
              >
                <span
                  className="text-[14.5px] font-semibold"
                  style={{ color: activeConversation.employeeAvatarFg }}
                >
                  {activeConversation.employeeInitials}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[15.5px] font-semibold text-[var(--ink)] truncate">
                  {activeConversation.employeeName}
                </div>
                <div className="text-[12.5px] text-[var(--ink-3)] truncate">
                  {activeConversation.employeeOnline ? 'online' : 'offline'} ·{' '}
                  {activeConversation.employeeDepartment}
                  {activeConversation.activeTicketNumber
                    ? ` · ${activeConversation.activeTicketNumber}`
                    : ''}
                </div>
              </div>

              {/* Header Actions / Mode (Frame 4 vs Frame 5 of nexo.pen) */}
              {activeConversation.status === 'WAITING_ANALYST' && (
                <div className="px-3 py-1.5 rounded-full bg-[var(--warning-soft)] text-[var(--warning-text)] text-[12.5px] font-semibold flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Aguardando atendente</span>
                </div>
              )}

              {activeConversation.status === 'WITH_ANALYST' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAnalystAction('return-to-agent')}
                    className="h-9 px-3 rounded-[8px] border border-[#1B24311F] hover:bg-[var(--desk)] text-[13px] font-medium text-[var(--ink-2)] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    <span>Devolver ao agent</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAnalystAction('close')}
                    className="h-9 px-3 rounded-[8px] bg-[var(--danger-soft)] hover:bg-[#EE343B24] text-[13px] font-semibold text-[var(--danger-text)] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Encerrar atendimento</span>
                  </button>
                </div>
              )}

              {activeConversation.status === 'ACTIVE_WITH_AGENT' && (
                <div className="px-3 py-1.5 rounded-full bg-[var(--success-soft)] text-[var(--success-text)] text-[12.5px] font-semibold flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5" />
                  <span>Agent atendendo</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowTicketPanel((v) => !v)}
                title="Alternar painel de chamados do colaborador"
                className="w-9 h-9 rounded-full hover:bg-[var(--desk)] flex items-center justify-center text-[var(--ink-2)] cursor-pointer"
              >
                <EllipsisVertical className="w-[18px] h-[18px]" />
              </button>
            </header>

            {/* Case Summary Banner (Anexo A: "Leva um resumo do caso") */}
            {activeConversation.handoffSummary && (
              <div className="mx-10 mt-3 p-3.5 rounded-xl bg-[var(--paper)] border border-[var(--rule)] shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />
                    Resumo do Caso pelo Nexo Assist ({activeConversation.handoffSummary.targetTier})
                  </span>
                  <span className="font-data text-[var(--ink-3)]">
                    Motivo: {activeConversation.handoffSummary.reasonLabel} · Confiança:{' '}
                    {activeConversation.handoffSummary.confidence}%
                  </span>
                </div>
                <p className="text-[13px] text-[var(--ink-2)] leading-relaxed">
                  {activeConversation.handoffSummary.summary}
                </p>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-10 py-5 space-y-4">
              {/* Day Pill */}
              <div className="flex justify-center">
                <span className="px-2.5 py-1 rounded-full bg-[#FFFFFFCC] text-[12px] font-medium text-[var(--ink-3)]">
                  Hoje
                </span>
              </div>

              {messages.map((msg) => {
                const msgDate = new Date(msg.createdAt);
                const timeStr = `${String(msgDate.getHours()).padStart(2, '0')}:${String(
                  msgDate.getMinutes()
                ).padStart(2, '0')}`;

                if (msg.senderType === 'system') {
                  return (
                    <div key={msg.id} className="flex items-center gap-3 py-2">
                      <div className="h-px flex-1 bg-[#1B243114]" />
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--ink-3)]">
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>{msg.content}</span>
                      </div>
                      <div className="h-px flex-1 bg-[#1B243114]" />
                    </div>
                  );
                }

                if (msg.senderType === 'employee') {
                  return (
                    <div key={msg.id} className="flex justify-start">
                      <div className="max-w-[440px] rounded-tl-[4px] rounded-tr-[12px] rounded-bl-[12px] rounded-br-[12px] bg-[var(--paper)] px-3 py-2 shadow-2xs flex items-end gap-2.5">
                        <span className="text-[14.5px] leading-[1.45] text-[var(--ink)]">
                          {msg.content}
                        </span>
                        <span className="text-[11px] text-[var(--ink-3)] shrink-0">{timeStr}</span>
                      </div>
                    </div>
                  );
                }

                if (msg.senderType === 'analyst') {
                  return (
                    <div key={msg.id} className="flex flex-col items-end space-y-1">
                      <div className="flex items-center gap-1.5 px-1">
                        <span className="text-[12px] font-semibold text-[var(--ink-2)]">
                          {msg.senderName}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-[6px] bg-[var(--success-soft)] text-[var(--success-text)] text-[11px] font-semibold">
                          {msg.senderRole || 'Suporte N2'}
                        </span>
                      </div>
                      <div className="w-[420px] max-w-full rounded-tl-[12px] rounded-tr-[4px] rounded-bl-[12px] rounded-br-[12px] bg-[var(--bubble-analyst-console)] px-3 py-2 space-y-0.5">
                        <div className="text-[14.5px] leading-[1.45] text-[var(--ink)]">
                          {msg.content}
                        </div>
                        <div className="flex items-center justify-end gap-1 text-[11px] text-[var(--ink-3)]">
                          <span>{timeStr}</span>
                          <CheckCheck className="w-3.5 h-3.5 text-[var(--primary)]" />
                        </div>
                      </div>
                    </div>
                  );
                }

                // Agent Message in Console (fill=#E6EFFA per nexo.pen)
                return (
                  <div key={msg.id} className="flex flex-col items-end space-y-1">
                    <div className="flex items-center gap-1.5 px-1">
                      {msg.decisionTrace && (
                        <button
                          type="button"
                          onClick={() => setInspectedTrace(msg.decisionTrace!)}
                          className="text-[11px] text-[var(--primary-text)] hover:underline flex items-center gap-1 mr-1 cursor-pointer"
                        >
                          <Sparkles className="w-3 h-3" />
                          <span>
                            Decisão ({msg.decisionTrace.confidence}%):{' '}
                            {msg.decisionTrace.steps.join(' · ')}
                          </span>
                        </button>
                      )}
                      <span className="text-[12px] font-semibold text-[var(--ink-2)]">
                        Nexo Assist
                      </span>
                      <span className="px-1.5 py-0.5 rounded-[6px] bg-[var(--primary-soft)] text-[var(--primary-text)] text-[11px] font-semibold">
                        IA
                      </span>
                    </div>
                    <div className="w-[420px] max-w-full rounded-tl-[12px] rounded-tr-[4px] rounded-bl-[12px] rounded-br-[12px] bg-[var(--bubble-ai-console)] px-3 py-2 space-y-0.5">
                      <div className="text-[14.5px] leading-[1.45] text-[var(--ink)]">
                        {msg.content}
                      </div>
                      <div className="flex items-center justify-end gap-1 text-[11px] text-[var(--ink-3)]">
                        <span>{timeStr}</span>
                        <CheckCheck className="w-3.5 h-3.5 text-[var(--primary)]" />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Takeover Bar (Frame 4 locked vs Frame 5 unlocked in nexo.pen) */}
            <div className="px-5 py-3 bg-[var(--paper)] border-t border-[var(--rule)] space-y-2.5 shrink-0">
              {activeConversation.status !== 'WITH_ANALYST' ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[var(--warning-soft)] flex items-center justify-center shrink-0">
                      <Hand className="w-[17px] h-[17px] text-[var(--warning-text)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] font-semibold text-[var(--ink)]">
                        {activeConversation.status === 'WAITING_ANALYST'
                          ? `${firstName} espera um atendente`
                          : activeConversation.status === 'ACTIVE_WITH_AGENT'
                            ? `${firstName} está conversando com o agent`
                            : 'Atendimento encerrado'}
                      </div>
                      <div className="text-[12.5px] text-[var(--ink-3)]">
                        {activeConversation.handoffSummary?.pausedUntilLabel ??
                          (activeConversation.status === 'WAITING_ANALYST'
                            ? 'Agent pausado · até 12:05'
                            : 'Assuma se desejar intervir manualmente')}
                      </div>
                    </div>

                    {activeConversation.status === 'WAITING_ANALYST' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAnalystAction('return-to-agent')}
                        className="h-9 px-3.5 rounded-[8px] border border-[#1B24311F] hover:bg-[var(--desk)] text-[13.5px] font-medium text-[var(--ink-2)] flex items-center gap-2 transition-colors cursor-pointer"
                      >
                        <Bot className="w-4 h-4" />
                        <span>Devolver ao agent</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAnalystAction('takeover')}
                      className="h-9 px-4 rounded-[8px] bg-[var(--cta)] hover:bg-[var(--primary-hover)] text-white text-[13.5px] font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Headset className="w-4 h-4" />
                      <span>Assumir atendimento</span>
                    </button>
                  </div>

                  {/* Locked Composer */}
                  <div className="h-[44px] px-3.5 rounded-[12px] bg-[var(--desk)] flex items-center text-[14.5px] text-[var(--ink-3)]">
                    Assuma o atendimento para responder
                  </div>
                </>
              ) : (
                /* Unlocked Composer when Analyst Assumed (Frame 5 of nexo.pen) */
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (analystInput.trim()) {
                      handleAnalystAction('message');
                    }
                  }}
                  className="flex items-center gap-2.5"
                >
                  <input
                    type="text"
                    value={analystInput}
                    onChange={(e) => setAnalystInput(e.target.value)}
                    placeholder={`Responder para ${activeConversation.employeeName} como ${analyst.name} (${analyst.tier})…`}
                    className="flex-1 h-[44px] px-3.5 rounded-[12px] bg-[var(--desk)] text-[14.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none focus:ring-1 focus:ring-[var(--cta)]"
                  />
                  <button
                    type="submit"
                    disabled={busy || !analystInput.trim()}
                    className="w-[44px] h-[44px] rounded-[12px] bg-[var(--cta)] hover:bg-[var(--primary-hover)] disabled:opacity-40 text-white flex items-center justify-center transition-colors cursor-pointer"
                    title="Enviar resposta do analista"
                  >
                    <ArrowUp className="w-[18px] h-[18px]" />
                  </button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[14px] text-[var(--ink-3)]">
            Selecione uma conversa à esquerda.
          </div>
        )}
      </section>

      {/* 4. Right Ticket History Panel (340px width per nexo.pen) */}
      {showTicketPanel && activeConversation && (
        <aside className="w-[340px] shrink-0 h-full bg-[var(--paper)] border-l border-[var(--rule)] flex flex-col">
          {/* Header */}
          <div className="h-16 pl-5 pr-3.5 border-b border-[var(--rule)] flex items-center justify-between shrink-0">
            <div>
              <div className="text-[15.5px] font-semibold text-[var(--ink)]">
                Chamados de {firstName}
              </div>
              <div className="text-[12.5px] text-[var(--ink-3)]">
                {openTicketsCount} abertos · {closedTicketsCount} encerrados
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowTicketPanel(false)}
              className="w-9 h-9 rounded-full hover:bg-[var(--desk)] flex items-center justify-center text-[var(--ink-2)] cursor-pointer"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-8">
            {/* Desta conversa */}
            {currentTicket && (
              <div className="space-y-3">
                <div className="text-[12.5px] font-semibold text-[var(--ink-3)]">
                  Desta conversa
                </div>
                <div
                  onClick={() => setSelectedModalTicket(currentTicket)}
                  className="p-4 rounded-[12px] bg-[var(--desk)] space-y-3.5 cursor-pointer hover:ring-1 hover:ring-[var(--rule)] transition-all"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-data text-[12.5px] font-medium text-[var(--ink-3)]">
                        {currentTicket.number}
                      </span>
                      <span
                        className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${
                          currentTicket.status === 'Em atendimento'
                            ? 'text-[var(--primary-text)]'
                            : 'text-[var(--warning-text)]'
                        }`}
                      >
                        <span
                          className={`w-[7px] h-[7px] rounded-full ${
                            currentTicket.status === 'Em atendimento'
                              ? 'bg-[var(--primary)]'
                              : 'bg-[var(--warning)]'
                          }`}
                        />
                        {currentTicket.status}
                      </span>
                    </div>

                    <div className="text-[15.5px] font-semibold text-[var(--ink)] leading-[1.3]">
                      {currentTicket.title}
                    </div>
                    <div className="text-[13.5px] text-[var(--ink-3)]">
                      {currentTicket.category} · prioridade {currentTicket.priority.toLowerCase()}
                    </div>
                  </div>

                  {/* Last Event */}
                  <div className="pt-3 border-t border-[var(--rule)] flex items-center gap-2 text-[13px]">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-[var(--ink-3)] shrink-0" />
                    <span className="text-[var(--ink-2)] flex-1 truncate">
                      {activeConversation.status === 'WITH_ANALYST'
                        ? `Assumido por ${activeConversation.assignedAnalystName || analyst.name}`
                        : 'Transferido para um analista'}
                    </span>
                    <span className="text-[12px] text-[var(--ink-3)]">10:05</span>
                  </div>
                </div>
              </div>
            )}

            {/* Outros chamados */}
            <div className="space-y-1">
              <div className="text-[12.5px] font-semibold text-[var(--ink-3)] pb-1">
                Outros chamados
              </div>
              <div className="divide-y divide-[var(--rule)]">
                {otherTickets.map((t) => {
                  const dot =
                    t.status === 'Em andamento' || t.status === 'Em atendimento'
                      ? 'bg-[var(--primary)]'
                      : t.status === 'Aprovado'
                        ? 'bg-[var(--success)]'
                        : t.status === 'Aguardando analista'
                          ? 'bg-[var(--warning)]'
                          : 'bg-[#1B243140]';

                  return (
                    <button
                      key={t.number}
                      type="button"
                      onClick={() => setSelectedModalTicket(t)}
                      className="w-full py-3 flex items-center gap-3 text-left hover:bg-[var(--desk)] px-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      <span className={`w-[7px] h-[7px] rounded-full ${dot} shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-medium text-[var(--ink)] truncate">
                          {t.title}
                        </div>
                        <div className="text-[12.5px] text-[var(--ink-3)]">
                          {t.number} · {t.status}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--ink-3)] shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[var(--rule)]">
            <button
              type="button"
              onClick={() => setSelectedModalTicket(currentTicket || employeeTickets[0] || null)}
              className="w-full h-9 rounded-[8px] border border-[#1B24311F] hover:bg-[var(--desk)] text-[13.5px] font-medium text-[var(--ink-2)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Ver todos os chamados de {firstName}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[var(--ink-3)]" />
            </button>
          </div>
        </aside>
      )}

      {/* Modal de Detalhe de Chamado do Colaborador */}
      {selectedModalTicket && (
        <div className="fixed inset-0 z-50 bg-[#1B24314D] flex items-center justify-center p-4">
          <div className="w-full max-w-[560px] rounded-2xl bg-[var(--paper)] border border-[var(--rule)] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--rule)] flex items-center justify-between">
              <div>
                <span className="font-data text-[12.5px] text-[var(--ink-3)]">
                  {selectedModalTicket.number} · {selectedModalTicket.category}
                </span>
                <h3 className="text-[17px] font-semibold text-[var(--ink)]">
                  {selectedModalTicket.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedModalTicket(null)}
                className="w-8 h-8 rounded-full hover:bg-[var(--desk)] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-[14px] text-[var(--ink-2)] whitespace-pre-line leading-relaxed">
                {selectedModalTicket.description}
              </p>
              <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-[var(--desk)] text-[13px]">
                <div>
                  <span className="text-[var(--ink-3)] block text-[11.5px]">Prioridade</span>
                  <span className="font-semibold text-[var(--ink)]">
                    {selectedModalTicket.priority}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--ink-3)] block text-[11.5px]">Status</span>
                  <span className="font-semibold text-[var(--ink)]">
                    {selectedModalTicket.status}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--ink-3)] block text-[11.5px]">Afetados</span>
                  <span className="font-semibold text-[var(--ink)]">
                    {selectedModalTicket.affectedScope}
                  </span>
                </div>
              </div>
              {selectedModalTicket.events.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                    Histórico de Eventos
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {selectedModalTicket.events.map((ev) => (
                      <div
                        key={ev.id}
                        className="text-[12.5px] text-[var(--ink-2)] p-2 rounded-lg bg-[var(--desk)] flex items-center justify-between"
                      >
                        <span>
                          <strong>{ev.actor}:</strong> {ev.description}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drawer de Inspeção de Decisões do Agente no Console */}
      <DecisionInspectorDrawer
        trace={inspectedTrace}
        onClose={() => setInspectedTrace(null)}
      />
    </div>
  );
}
