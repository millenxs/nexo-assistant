'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  ArrowUp,
  Check,
  ChevronRight,
  Headset,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MessageSquare,
  RotateCcw,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react';
import {
  AffectedScope,
  Conversation,
  DecisionTrace,
  Employee,
  Message,
  Ticket,
  TicketCategory,
  TicketPriority,
  TicketType,
} from '@/domain/types';
import { NexoMark } from './NexoMark';
import {
  DraftConfirmationCard,
  TicketDetailCard,
  TicketSelectorCard,
} from './MessageCards';
import { DecisionInspectorDrawer } from './DecisionInspectorDrawer';

export function EmployeeWorkspace({
  employee,
  allEmployees,
  onSwitchEmployee,
  onOpenAnalystConsole,
  onLogout,
}: {
  employee: Employee;
  allEmployees: Employee[];
  onSwitchEmployee: (emp: Employee) => void;
  onOpenAnalystConsole: () => void;
  onLogout: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'chat' | 'profile'>('chat');
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [legacyMode, setLegacyMode] = useState<'0' | 'transient' | 'down'>('0');
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [inspectedTrace, setInspectedTrace] = useState<DecisionTrace | null>(null);
  const [passwordResetSent, setPasswordResetSent] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const fetchChatState = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/chat?employeeId=${encodeURIComponent(employee.id)}`);
      const data = await res.json();
      if (res.ok) {
        setConversation(data.conversation);
        setMessages(data.messages || []);
        setTickets(data.tickets || []);
        if (data.legacyMode) setLegacyMode(data.legacyMode);
      }
    } catch {
      if (!silent) setErrorBanner('Não foi possível sincronizar o histórico.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchChatState(false);
    const interval = setInterval(() => {
      fetchChatState(true);
    }, 2500);
    return () => clearInterval(interval);
  }, [employee.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend ?? composerText).trim();
    if (!content || sending) return;
    if (!textToSend) setComposerText('');
    setSending(true);
    setErrorBanner(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          employeeId: employee.id,
          conversationId: conversation?.id,
          message: content,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Erro ao enviar mensagem.');
      } else {
        setConversation(data.conversation);
        setMessages(data.messages || []);
        setTickets(data.tickets || []);
        if (data.error) setErrorBanner(data.error);
      }
    } catch {
      setErrorBanner('Erro de comunicação com o servidor.');
    } finally {
      setSending(false);
    }
  };

  const handleStartPreset = async (preset: 'empty' | 'vpn-draft' | 'reset-all') => {
    setSending(true);
    setErrorBanner(null);
    try {
      if (preset === 'reset-all') {
        await fetch('/api/system', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset-seeds' }),
        });
        await fetchChatState(false);
        return;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'new-session',
          employeeId: employee.id,
          preset,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setConversation(data.conversation);
        setMessages(data.messages || []);
        setTickets(data.tickets || []);
      }
    } finally {
      setSending(false);
    }
  };

  const handleDraftAction = async (
    action: 'confirm' | 'edit' | 'cancel',
    draftId: string,
    updates?: {
      type: TicketType;
      title: string;
      description: string;
      category: TicketCategory;
      priority: TicketPriority;
      affectedScope: AffectedScope;
    }
  ) => {
    if (!conversation) return;
    setSending(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          draftId,
          employeeId: employee.id,
          conversationId: conversation.id,
          updates,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Falha ao processar rascunho.');
      } else {
        setConversation(data.conversation);
        setMessages(data.messages || []);
        setTickets(data.tickets || []);
      }
    } finally {
      setSending(false);
    }
  };

  const handleToggleLegacyMode = async () => {
    const nextMode: '0' | 'transient' | 'down' =
      legacyMode === '0' ? 'transient' : legacyMode === 'transient' ? 'down' : '0';
    setLegacyMode(nextMode);
    await fetch('/api/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-legacy-mode', mode: nextMode }),
    });
  };

  const statusBadge = (() => {
    if (!conversation || conversation.status === 'ACTIVE_WITH_AGENT') {
      return {
        bg: 'bg-[var(--success-soft)]',
        dot: 'bg-[var(--success)]',
        text: 'text-[var(--success-text)]',
        label: 'Assistente online',
      };
    }
    if (conversation.status === 'WAITING_ANALYST') {
      return {
        bg: 'bg-[var(--warning-soft)]',
        dot: 'bg-[var(--warning)]',
        text: 'text-[var(--warning-text)]',
        label: 'Aguardando atendente (Agent pausado)',
      };
    }
    if (conversation.status === 'WITH_ANALYST') {
      return {
        bg: 'bg-[var(--primary-soft)]',
        dot: 'bg-[var(--primary)]',
        text: 'text-[var(--primary-text)]',
        label: `${conversation.assignedAnalystName || 'Analista'} atendendo · Agent pausado`,
      };
    }
    return {
      bg: 'bg-[var(--desk)]',
      dot: 'bg-[#1B243155]',
      text: 'text-[var(--ink-3)]',
      label: 'Conversa encerrada',
    };
  })();

  return (
    <div className="h-screen w-full bg-[var(--paper)] flex overflow-hidden">
      {/* Sidebar (232px width per nexo.pen) */}
      <aside className="w-[232px] shrink-0 h-full border-r border-[var(--rule)] flex flex-col pt-5 pb-3.5 px-3.5">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-2">
          <NexoMark size={20} color="#037AF6" />
          <span className="text-[16px] font-bold tracking-[-0.2px] text-[var(--ink)]">
            Nexo Assist
          </span>
        </div>

        <div className="h-[22px]" />

        {/* Navigation */}
        <nav className="space-y-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`w-full h-9 px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13.5px] transition-colors cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-[var(--primary-soft)] text-[var(--primary-text)] font-semibold'
                : 'text-[var(--ink-2)] font-medium hover:bg-[var(--desk)]'
            }`}
          >
            <MessageSquare
              className={`w-4 h-4 ${
                activeTab === 'chat' ? 'text-[var(--primary-text)]' : 'text-[var(--ink-3)]'
              }`}
            />
            <span>Atendimento</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`w-full h-9 px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13.5px] transition-colors cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-[var(--primary-soft)] text-[var(--primary-text)] font-semibold'
                : 'text-[var(--ink-2)] font-medium hover:bg-[var(--desk)]'
            }`}
          >
            <UserRound
              className={`w-4 h-4 ${
                activeTab === 'profile' ? 'text-[var(--primary-text)]' : 'text-[var(--ink-3)]'
              }`}
            />
            <span>Meu perfil</span>
          </button>
        </nav>

        {/* Demo Scenario Shortcuts & Analyst Console Switch */}
        <div className="mt-6 pt-4 border-t border-[var(--rule)] space-y-1.5 px-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-3)] px-1.5">
            Cenários do Protótipo (.pen)
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveTab('chat');
              handleStartPreset('vpn-draft');
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-[12px] text-[var(--ink-2)] hover:bg-[var(--desk)] transition-colors cursor-pointer"
          >
            Tela 2 · Novo chamado (VPN 809)
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('chat');
              handleStartPreset('reset-all');
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-[12px] text-[var(--ink-2)] hover:bg-[var(--desk)] transition-colors cursor-pointer"
          >
            Tela 3 · Consulta e prazo vencido
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('chat');
              handleStartPreset('empty');
            }}
            className="w-full text-left px-2 py-1.5 rounded-md text-[12px] text-[var(--ink-2)] hover:bg-[var(--desk)] transition-colors cursor-pointer"
          >
            Conversa em branco (testar livre)
          </button>

          <div className="pt-2">
            <button
              type="button"
              onClick={onOpenAnalystConsole}
              className="w-full h-8 px-2.5 rounded-[8px] bg-[var(--ink)] text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Headset className="w-3.5 h-3.5" />
              <span>Console do Analista</span>
            </button>
          </div>
        </div>

        <div className="flex-1" />

        {/* Quick Persona Selector for Testing Isolation */}
        <div className="mb-2 px-1">
          <label className="text-[11px] text-[var(--ink-3)] block mb-1">
            Funcionário autenticado:
          </label>
          <select
            value={employee.id}
            onChange={(e) => {
              const found = allEmployees.find((emp) => emp.id === e.target.value);
              if (found) onSwitchEmployee(found);
            }}
            className="w-full h-7 px-2 rounded-md bg-[var(--desk)] border border-[var(--rule)] text-[12px] text-[var(--ink)]"
          >
            {allEmployees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.os})
              </option>
            ))}
          </select>
        </div>

        {/* User Footer */}
        <div className="pt-3.5 pb-1 px-2 border-t border-[var(--rule)] flex items-center gap-2.5">
          <div className="w-[34px] h-[34px] rounded-full bg-[var(--primary-soft)] flex items-center justify-center shrink-0">
            <span className="text-[12.5px] font-bold text-[var(--primary-text)]">
              {employee.initials}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[var(--ink)] truncate">
              {employee.name}
            </div>
            <div className="text-[11.5px] text-[var(--ink-3)] truncate">{employee.email}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="mt-1 w-full h-[34px] px-2.5 rounded-[8px] flex items-center gap-2.5 text-[13.5px] font-medium text-[var(--ink-2)] hover:bg-[var(--desk)] transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 text-[var(--ink-3)]" />
          <span>Sair</span>
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 h-full flex flex-col min-w-0 bg-[var(--paper)]">
        {/* Top Bar (64px height per nexo.pen) */}
        <header className="h-16 px-8 border-b border-[var(--rule)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[13.5px]">
            <span className="text-[var(--ink-3)]">Service desk de TI</span>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--ink-3)]" />
            <span className="font-semibold text-[var(--ink)]">
              {activeTab === 'chat' ? 'Atendimento' : 'Meu perfil'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Simulated Legacy System Toggle */}
            <button
              type="button"
              onClick={handleToggleLegacyMode}
              title="Simular comportamento do sistema legado de chamados (Estável / Retry lento / Indisponível)"
              className={`h-7 px-2.5 rounded-full text-[11.5px] font-medium flex items-center gap-1.5 border cursor-pointer transition-colors ${
                legacyMode === '0'
                  ? 'bg-[var(--desk)] border-[var(--rule)] text-[var(--ink-2)]'
                  : legacyMode === 'transient'
                    ? 'bg-[var(--warning-soft)] border-[#F5A50040] text-[var(--warning-text)]'
                    : 'bg-[var(--danger-soft)] border-[#EE343B40] text-[var(--danger-text)]'
              }`}
            >
              <Wrench className="w-3 h-3" />
              <span>
                Sistema legado:{' '}
                {legacyMode === '0'
                  ? 'Estável'
                  : legacyMode === 'transient'
                    ? 'Oscilando (Retry)'
                    : 'Indisponível (Timeout)'}
              </span>
            </button>

            {/* Status Pill */}
            <div
              className={`px-3 py-1 rounded-full flex items-center gap-2 text-[12.5px] font-semibold ${statusBadge.bg} ${statusBadge.text}`}
            >
              <span className={`w-[7px] h-[7px] rounded-full ${statusBadge.dot}`} />
              <span>{statusBadge.label}</span>
            </div>
          </div>
        </header>

        {/* Tab 1: Chat View */}
        {activeTab === 'chat' ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto px-8 lg:px-[140px] xl:px-[200px] py-7 space-y-6">
              {loading ? (
                <div className="py-16 text-center text-[14px] text-[var(--ink-3)]">
                  Carregando atendimento…
                </div>
              ) : messages.length === 0 ? (
                <div className="max-w-[600px] mx-auto my-8 p-6 rounded-2xl bg-[var(--desk)] border border-[var(--rule)] space-y-4">
                  <div className="space-y-1">
                    <div className="text-[15px] font-semibold text-[var(--ink)]">
                      Olá, {employee.name.split(' ')[0]}! Como posso ajudar com TI hoje?
                    </div>
                    <p className="text-[13.5px] text-[var(--ink-3)]">
                      Descreva seu problema ou escolha um exemplo abaixo para testar as regras do
                      Nexo Assist:
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleSendMessage(
                          'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.'
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-[var(--paper)] border border-[#1B24311F] text-[13px] text-[var(--ink)] hover:bg-[#0062C40A] cursor-pointer"
                    >
                      VPN com erro 809 ({employee.os})
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendMessage('Qual o status do meu chamado?')}
                      className="px-3 py-1.5 rounded-lg bg-[var(--paper)] border border-[#1B24311F] text-[13px] text-[var(--ink)] hover:bg-[#0062C40A] cursor-pointer"
                    >
                      Qual o status do meu chamado?
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleSendMessage('Minha senha do SAP ficou bloqueada novamente hoje.')
                      }
                      className="px-3 py-1.5 rounded-lg bg-[var(--paper)] border border-[#1B24311F] text-[13px] text-[var(--ink)] hover:bg-[#0062C40A] cursor-pointer"
                    >
                      Senha do SAP bloqueada (Reabertura ≤ 7 dias)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleSendMessage(
                          'Gostaria de solicitar um segundo monitor para home office.'
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-[var(--paper)] border border-[#1B24311F] text-[13px] text-[var(--ink)] hover:bg-[#0062C40A] cursor-pointer"
                    >
                      Pedir 2º monitor (REQ · Baixa)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleSendMessage('Qual o horário de atendimento do service desk?')
                      }
                      className="px-3 py-1.5 rounded-lg bg-[var(--paper)] border border-[#1B24311F] text-[13px] text-[var(--ink)] hover:bg-[#0062C40A] cursor-pointer"
                    >
                      Dúvida: Horário do service desk
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleSendMessage('Como solicito minhas férias e segunda via do holerite?')
                      }
                      className="px-3 py-1.5 rounded-lg bg-[var(--paper)] border border-[#1B24311F] text-[13px] text-[var(--ink)] hover:bg-[#0062C40A] cursor-pointer"
                    >
                      Fora do escopo (RH)
                    </button>
                  </div>
                </div>
              ) : (
                messages.map((msg) => {
                  if (msg.senderType === 'system') {
                    return (
                      <div key={msg.id} className="flex items-center gap-3 py-1">
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
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[520px] rounded-tl-[14px] rounded-tr-[14px] rounded-bl-[14px] rounded-br-[4px] bg-[var(--ink)] text-white px-4 py-3 text-[14.5px] leading-[1.5]">
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  if (msg.senderType === 'analyst') {
                    return (
                      <div key={msg.id} className="space-y-1.5">
                        <div className="flex items-center gap-2 text-[12.5px]">
                          <span className="font-semibold text-[var(--ink)]">{msg.senderName}</span>
                          <span className="px-2 py-0.5 rounded-md bg-[var(--success-soft)] text-[var(--success-text)] text-[11.5px] font-semibold">
                            {msg.senderRole || 'Analista N2'}
                          </span>
                        </div>
                        <div className="w-[600px] max-w-full rounded-[14px] bg-[var(--bubble-analyst-console)] border border-[#00BD6C29] p-4 text-[14.5px] leading-[1.5] text-[var(--ink)]">
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  // Agent Message (Matches nexo.pen Status Line + Bubble + Cards + Options)
                  return (
                    <div key={msg.id} className="space-y-2.5">
                      {/* Status Line above response (item 7 of PDF + nexo.pen) */}
                      <div className="flex items-center gap-2.5 flex-wrap text-[12.5px]">
                        <span className="font-semibold text-[var(--ink)]">Nexo Assist</span>
                        {msg.decisionTrace?.steps.map((step, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setInspectedTrace(msg.decisionTrace!)}
                            className="inline-flex items-center gap-1 text-[var(--ink-3)] hover:text-[var(--primary-text)] transition-colors cursor-pointer"
                            title="Clique para inspecionar os detalhes desta decisão"
                          >
                            <Check className="w-3 h-3 text-[var(--ink-3)]" />
                            <span>{step}</span>
                          </button>
                        ))}
                        {msg.decisionTrace && (
                          <button
                            type="button"
                            onClick={() => setInspectedTrace(msg.decisionTrace!)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--desk)] hover:bg-[var(--primary-soft)] text-[11.5px] font-medium text-[var(--primary-text)] border border-[var(--rule)] transition-colors cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>Ver decisão · {msg.decisionTrace.confidence}%</span>
                          </button>
                        )}
                      </div>

                      {/* Ticket Card (if before bubble in Consulta view) */}
                      {msg.ticketCard && <TicketDetailCard ticket={msg.ticketCard} />}

                      {/* Main Agent Bubble */}
                      <div className="w-[600px] max-w-full rounded-[14px] bg-[var(--paper)] border border-[#1B243117] p-4 space-y-3">
                        <div className="text-[14.5px] leading-[1.55] text-[var(--ink)] whitespace-pre-line">
                          {msg.content}
                        </div>

                        {msg.questionPrompt && (
                          <div className="text-[14.5px] font-semibold text-[var(--ink)] pt-0.5">
                            {msg.questionPrompt}
                          </div>
                        )}

                        {msg.quickOptions && msg.quickOptions.length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {msg.quickOptions.map((opt, idx) => {
                              const isPrimary = opt.variant === 'primary';
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  disabled={sending}
                                  onClick={() => handleSendMessage(opt.value)}
                                  className={`h-8 px-3 rounded-[8px] text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                                    isPrimary
                                      ? 'bg-[var(--primary-soft)] text-[var(--primary-text)] border border-[#0285F730]'
                                      : 'bg-[var(--paper)] text-[var(--ink)] border border-[#1B24311F] hover:bg-[var(--desk)]'
                                  }`}
                                >
                                  {opt.key && (
                                    <span
                                      className={`w-4 h-4 rounded-[4px] text-[11px] flex items-center justify-center font-data ${
                                        isPrimary
                                          ? 'bg-[var(--primary)] text-white'
                                          : 'bg-[var(--desk)] text-[var(--ink-3)]'
                                      }`}
                                    >
                                      {opt.key}
                                    </span>
                                  )}
                                  <span>{opt.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Ticket Selector (if present) */}
                      {msg.ticketSelector && msg.ticketSelector.length > 0 && (
                        <TicketSelectorCard
                          tickets={msg.ticketSelector}
                          selectedNumber={conversation?.activeTicketNumber}
                          onSelectTicket={(t) =>
                            handleSendMessage(`${t.number} · ${t.title}`)
                          }
                        />
                      )}

                      {/* Draft Confirmation Card (if present) */}
                      {msg.draftCard && (
                        <DraftConfirmationCard
                          draft={msg.draftCard}
                          busy={sending}
                          onConfirm={(id) => handleDraftAction('confirm', id)}
                          onEdit={(id, updates) => handleDraftAction('edit', id, updates)}
                          onCancel={(id) => handleDraftAction('cancel', id)}
                        />
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer Area (padding 10px 200px 18px 200px per nexo.pen) */}
            <div className="px-8 lg:px-[140px] xl:px-[200px] pt-2.5 pb-[18px] space-y-1.5 shrink-0">
              {errorBanner && (
                <div className="px-3.5 py-2 rounded-lg bg-[var(--danger-soft)] text-[var(--danger-text)] text-[13px] flex items-center justify-between">
                  <span>{errorBanner}</span>
                  <button
                    type="button"
                    onClick={() => setErrorBanner(null)}
                    className="text-[12px] font-semibold underline cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {conversation &&
                (conversation.status === 'WAITING_ANALYST' ||
                  conversation.status === 'WITH_ANALYST') && (
                  <div className="px-3.5 py-2 rounded-lg bg-[var(--warning-soft)] border border-[#F5A50030] text-[12.5px] text-[var(--warning-text)] flex items-center justify-between">
                    <span>
                      {conversation.status === 'WAITING_ANALYST'
                        ? 'O Nexo Assist está pausado aguardando um analista assumir. Suas mensagens vão direto para a fila do suporte.'
                        : `${conversation.assignedAnalystName || 'Rafael Lima'} está atendendo esta conversa (Nexo Assist pausado).`}
                    </span>
                    <button
                      type="button"
                      onClick={onOpenAnalystConsole}
                      className="font-semibold underline ml-3 shrink-0 cursor-pointer"
                    >
                      Abrir no Console do Analista →
                    </button>
                  </div>
                )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="h-[48px] pl-4 pr-1.5 rounded-[12px] bg-[var(--paper)] border border-[#1B24311F] focus-within:border-[var(--cta)] flex items-center gap-2"
              >
                <input
                  type="text"
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  disabled={
                    sending ||
                    conversation?.status === 'CLOSED' ||
                    (conversation ? conversation.messageCount >= conversation.maxMessages : false)
                  }
                  placeholder={
                    conversation?.status === 'CLOSED'
                      ? 'Conversa encerrada. Inicie uma nova sessão na barra lateral.'
                      : 'Escreva para o Nexo…'
                  }
                  className="flex-1 text-[14.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)] bg-transparent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={
                    sending ||
                    !composerText.trim() ||
                    conversation?.status === 'CLOSED' ||
                    (conversation ? conversation.messageCount >= conversation.maxMessages : false)
                  }
                  className="h-9 px-3 rounded-[6px] bg-[var(--cta)] hover:bg-[var(--primary-hover)] disabled:opacity-40 text-white text-[13.5px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>{sending ? 'Enviando…' : 'Enviar'}</span>
                </button>
              </form>

              <div className="flex items-center justify-between text-[12.5px] text-[var(--ink-3)]">
                <span>
                  Dica: clique nos passos acima de qualquer resposta da IA para ver os detalhes da
                  decisão.
                </span>
                <span className="font-data">
                  {conversation?.messageCount ?? 0}/{conversation?.maxMessages ?? 30} mensagens
                  nesta sessão
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* Tab 2: Cliente — Meu perfil (Frame 6 of nexo.pen) */
          <div className="flex-1 overflow-y-auto px-10 py-12 flex justify-center">
            <div className="w-full max-w-[600px] space-y-8">
              {/* Heading */}
              <div className="space-y-1.5">
                <h2 className="text-[24px] font-bold tracking-[-0.4px] text-[var(--ink)]">
                  Meu perfil
                </h2>
                <p className="text-[14.5px] text-[var(--ink-3)]">
                  Seus dados de acesso ao service desk de TI.
                </p>
              </div>

              {/* Dados Card */}
              <div className="rounded-[16px] bg-[var(--paper)] border border-[#1B243117] divide-y divide-[var(--rule)]">
                <div className="px-6 py-5 flex items-center gap-4">
                  <span className="w-[160px] text-[13.5px] text-[var(--ink-3)] shrink-0">
                    Nome
                  </span>
                  <span className="text-[14.5px] font-medium text-[var(--ink)]">
                    {employee.name}
                  </span>
                </div>

                <div className="px-6 py-5 flex items-center gap-4">
                  <span className="w-[160px] text-[13.5px] text-[var(--ink-3)] shrink-0">
                    E-mail corporativo
                  </span>
                  <span className="text-[14.5px] font-medium text-[var(--ink)] flex-1">
                    {employee.email}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--ink-3)]">
                    <Lock className="w-3.5 h-3.5" />
                    Gerenciado pela TI
                  </span>
                </div>

                <div className="px-6 py-5 flex items-center gap-4">
                  <span className="w-[160px] text-[13.5px] text-[var(--ink-3)] shrink-0">
                    Departamento e SO
                  </span>
                  <span className="text-[14.5px] font-medium text-[var(--ink)]">
                    {employee.department} · {employee.role} ({employee.os})
                  </span>
                </div>
              </div>

              {/* Senha Card */}
              <div className="rounded-[16px] bg-[var(--paper)] border border-[#1B243117] overflow-hidden">
                <div className="p-6 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--desk)] flex items-center justify-center shrink-0">
                    <KeyRound className="w-[18px] h-[18px] text-[var(--ink-2)]" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[14.5px] font-semibold text-[var(--ink)]">Senha</div>
                    <div className="text-[13.5px] text-[var(--ink-3)]">
                      Alterada há {employee.passwordChangedDaysAgo} dias
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPasswordResetSent(true)}
                    className="h-9 px-3.5 rounded-[8px] border border-[#1B24311F] hover:bg-[var(--desk)] text-[13.5px] font-medium text-[var(--ink-2)] flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Redefinir senha</span>
                  </button>
                </div>

                <div className="px-6 py-3 bg-[var(--desk)] border-t border-[var(--rule)] flex items-center gap-2 text-[13px] text-[var(--ink-3)]">
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {passwordResetSent
                      ? `Link de redefinição enviado com sucesso para ${employee.email}!`
                      : `Enviaremos um link de redefinição para ${employee.email}.`}
                  </span>
                </div>
              </div>

              {/* Resumo de Chamados do Colaborador */}
              <div className="space-y-3">
                <h3 className="text-[15px] font-semibold text-[var(--ink)]">
                  Meus chamados ({tickets.length})
                </h3>
                <div className="rounded-[16px] bg-[var(--paper)] border border-[#1B243117] divide-y divide-[var(--rule)]">
                  {tickets.map((t) => (
                    <div
                      key={t.number}
                      className="px-5 py-3.5 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-data text-[12.5px] text-[var(--ink-3)]">
                            {t.number}
                          </span>
                          <span className="text-[14px] font-medium text-[var(--ink)] truncate">
                            {t.title}
                          </span>
                        </div>
                        <div className="text-[12px] text-[var(--ink-3)] mt-0.5">
                          {t.category} · Prioridade {t.priority} · Atualizado{' '}
                          {t.lastUpdateRelativeLabel}
                        </div>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[12px] font-medium shrink-0 ${
                          t.status === 'Resolvido'
                            ? 'bg-[var(--desk)] text-[var(--ink-3)]'
                            : t.isOverdue
                              ? 'bg-[var(--warning-soft)] text-[var(--warning-text)]'
                              : 'bg-[var(--primary-soft)] text-[var(--primary-text)]'
                        }`}
                      >
                        {t.status}
                        {t.isOverdue ? ' · vencido' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Drawer de Inspeção de Decisões do Agente */}
      <DecisionInspectorDrawer
        trace={inspectedTrace}
        onClose={() => setInspectedTrace(null)}
      />
    </div>
  );
}
