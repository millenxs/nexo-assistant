'use client';

import React, { useState } from 'react';
import {
  AffectedScope,
  Ticket,
  TicketCategory,
  TicketDraft,
  TicketPriority,
  TicketType,
} from '@/domain/types';

export function TicketSelectorCard({
  tickets,
  selectedNumber,
  onSelectTicket,
}: {
  tickets: Ticket[];
  selectedNumber?: string | null;
  onSelectTicket: (ticket: Ticket) => void;
}) {
  return (
    <div className="w-full rounded-[16px] bg-[var(--paper)] outline outline-1 outline-[#1B243117] outline-offset-[-0.5px] shadow-[0px_1px_2px_#1B24310D,0px_6px_18px_#1B24310A] overflow-hidden divide-y divide-[var(--rule)]">
      {tickets.map((t, index) => {
        const isSelected = selectedNumber ? selectedNumber === t.number : index === 0;
        const dotColor =
          t.status === 'Aguardando analista'
            ? 'bg-[var(--warning)]'
            : t.status === 'Em andamento' || t.status === 'Em atendimento'
              ? 'bg-[var(--primary)]'
              : t.status === 'Aprovado'
                ? 'bg-[var(--success)]'
                : 'bg-[#1B243166]';

        const createdDate = new Date(t.createdAt);
        const dateLabel = createdDate.toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'short',
        }).replace('.', '');

        return (
          <button
            key={t.number}
            type="button"
            onClick={() => onSelectTicket(t)}
            className={`w-full h-[46px] px-4 flex items-center gap-3.5 text-left transition-colors cursor-pointer ${
              isSelected ? 'bg-[#0062C40A]' : 'hover:bg-[var(--desk)]'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                isSelected
                  ? 'border-[var(--cta)] border-[5px]'
                  : 'border-[#1B243138] bg-[var(--paper)]'
              }`}
            />
            <span className="font-data text-[12.5px] font-medium text-[var(--ink-3)] shrink-0">
              {t.number}
            </span>
            <span className="text-[14.5px] font-medium text-[var(--ink)] truncate flex-1">
              {t.title}
            </span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--ink-3)] shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              {t.status}
            </span>
            <span className="w-[44px] text-right text-[12.5px] text-[var(--ink-3)] shrink-0">
              {dateLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TicketDetailCard({ ticket }: { ticket: Ticket }) {
  const createdDate = new Date(ticket.createdAt);
  const createdLabel = `${createdDate
    .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    .replace('.', '')}, ${String(createdDate.getHours()).padStart(2, '0')}:${String(
    createdDate.getMinutes()
  ).padStart(2, '0')}`;

  const statusDot =
    ticket.status === 'Aguardando analista'
      ? 'bg-[var(--warning)]'
      : ticket.status === 'Aprovado' || ticket.status === 'Resolvido'
        ? 'bg-[var(--success)]'
        : 'bg-[var(--primary)]';

  const statusText =
    ticket.status === 'Aguardando analista'
      ? 'text-[var(--warning-text)]'
      : ticket.status === 'Aprovado' || ticket.status === 'Resolvido'
        ? 'text-[var(--success-text)]'
        : 'text-[var(--primary-text)]';

  return (
    <div className="w-full rounded-[16px] bg-[var(--paper)] outline outline-1 outline-[#1B243117] outline-offset-[-0.5px] shadow-[0px_1px_2px_#1B24310D,0px_6px_18px_#1B24310A] overflow-hidden">
      {/* Body */}
      <div className="px-[18px] pt-4 pb-3.5 space-y-1.5">
        <div className="flex items-center gap-2 pb-0.5 text-[12.5px]">
          <span className="text-[var(--ink-3)] font-medium">
            {ticket.type === 'REQ' ? 'Requisição' : 'Chamado'}
          </span>
          <span className="w-1 h-1 rounded-full bg-[var(--rule)]" />
          <span className="font-data text-[var(--ink-3)]">{ticket.number}</span>
          <div className="flex-1" />
          <span className={`flex items-center gap-1.5 font-semibold ${statusText}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            {ticket.status}
          </span>
        </div>

        <div className="text-[18px] font-semibold tracking-[-0.2px] text-[var(--ink)] leading-[23px]">
          {ticket.title}
        </div>
        <div className="text-[13.5px] text-[var(--ink-2)] leading-[20px] whitespace-pre-line">
          {ticket.description}
        </div>
      </div>

      {/* Grid Fields */}
      <div className="px-[18px] pb-4">
       <div className="border-t border-[var(--rule)] pt-3 grid grid-cols-4 gap-6 bg-[var(--paper)]">
        <div>
          <div className="text-[12.5px] text-[var(--ink-3)]">Categoria</div>
          <div className="text-[14.5px] font-medium text-[var(--ink)] mt-1">
            {ticket.subcategory
              ? `${ticket.category} › ${ticket.subcategory}`
              : ticket.category}
          </div>
        </div>
        <div>
          <div className="text-[12.5px] text-[var(--ink-3)]">Prioridade</div>
          <div className="text-[14.5px] font-medium text-[var(--ink)] mt-1 flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ticket.priority === 'Crítica'
                  ? 'bg-[var(--danger)]'
                  : ticket.priority === 'Alta'
                    ? 'bg-[var(--warning)]'
                    : 'bg-[#1B243166]'
              }`}
            />
            {ticket.priority}
          </div>
        </div>
        <div>
          <div className="text-[12.5px] text-[var(--ink-3)]">Aberto em</div>
          <div className="text-[14.5px] font-medium text-[var(--ink)] mt-1">
            {createdLabel}
          </div>
        </div>
        <div>
          <div className="text-[12.5px] text-[var(--ink-3)]">Última atualização</div>
          <div className="text-[14.5px] mt-1 flex items-center gap-1.5 flex-wrap">
            <span
              className={
                ticket.isOverdue
                  ? 'font-semibold text-[var(--warning-text)]'
                  : 'font-medium text-[var(--ink)]'
              }
            >
              {ticket.lastUpdateRelativeLabel ?? 'hoje'}
            </span>
            {ticket.isOverdue && (
              <span className="text-[12.5px] text-[var(--ink-3)]">· prazo vencido</span>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export function DraftConfirmationCard({
  draft,
  onConfirm,
  onEdit,
  onCancel,
  busy,
}: {
  draft: TicketDraft;
  onConfirm: (draftId: string) => void;
  onEdit: (
    draftId: string,
    updates: {
      type: TicketType;
      title: string;
      description: string;
      category: TicketCategory;
      priority: TicketPriority;
      affectedScope: AffectedScope;
    }
  ) => void;
  onCancel: (draftId: string) => void;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<TicketType>(draft.type);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [category, setCategory] = useState<TicketCategory>(draft.category);
  const [priority, setPriority] = useState<TicketPriority>(draft.priority);
  const [affectedScope, setAffectedScope] = useState<AffectedScope>(draft.affectedScope);

  const kindLabel =
    draft.operation === 'CREATE'
      ? 'Novo chamado'
      : draft.operation === 'REOPEN'
        ? `Reabertura · ${draft.targetTicketNumber}`
        : `Atualização · ${draft.targetTicketNumber}`;

  const isPending = draft.status === 'PENDING_CONFIRMATION';

  const handleSaveEdit = () => {
    onEdit(draft.id, {
      type,
      title,
      description,
      category,
      priority,
      affectedScope,
    });
    setEditing(false);
  };

  return (
    <div className="w-full rounded-[16px] bg-[var(--paper)] outline outline-1 outline-[#1B243117] outline-offset-[-0.5px] shadow-[0px_1px_2px_#1B24310D,0px_6px_18px_#1B24310A] overflow-hidden">
      {/* Body */}
      <div className="px-[18px] pt-4 pb-3.5 space-y-1.5">
        <div className="flex items-center gap-2 pb-0.5 text-[12.5px]">
          <span className="text-[var(--ink-3)] font-medium">{kindLabel}</span>
          <span className="w-1 h-1 rounded-full bg-[var(--rule)]" />
          <span className="font-data text-[var(--ink-3)]">Rascunho {draft.code}</span>
          <div className="flex-1" />
          {draft.status === 'PENDING_CONFIRMATION' && (
            <span className="flex items-center gap-1.5 font-semibold text-[var(--warning-text)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
              Aguardando confirmação
            </span>
          )}
          {draft.status === 'CONFIRMED' && (
            <span className="flex items-center gap-1.5 font-semibold text-[var(--success-text)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
              Confirmado
            </span>
          )}
          {draft.status === 'CANCELLED' && (
            <span className="flex items-center gap-1.5 font-medium text-[var(--ink-3)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1B243140]" />
              Cancelado
            </span>
          )}
        </div>

        {editing ? (
          <div className="space-y-2.5 pt-1">
            <div>
              <label className="text-[11.5px] font-medium text-[var(--ink-3)] block mb-1">
                Título do chamado
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-[#1B243124] text-[13.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--cta)]"
              />
            </div>
            <div>
              <label className="text-[11.5px] font-medium text-[var(--ink-3)] block mb-1">
                Descrição detalhada
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-[#1B243124] text-[13.5px] text-[var(--ink)] focus:outline-none focus:border-[var(--cta)]"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-[11px] text-[var(--ink-3)] block mb-1">Tipo</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as TicketType)}
                  className="w-full h-8 px-2 rounded-md border border-[#1B243124] text-[12.5px]"
                >
                  <option value="INC">INC · Incidente</option>
                  <option value="REQ">REQ · Requisição</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-[var(--ink-3)] block mb-1">Categoria</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as TicketCategory)}
                  className="w-full h-8 px-2 rounded-md border border-[#1B243124] text-[12.5px]"
                >
                  <option value="Acesso">Acesso</option>
                  <option value="Rede e VPN">Rede e VPN</option>
                  <option value="Hardware">Hardware</option>
                  <option value="Software">Software</option>
                  <option value="E-mail">E-mail</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-[var(--ink-3)] block mb-1">Prioridade</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TicketPriority)}
                  className="w-full h-8 px-2 rounded-md border border-[#1B243124] text-[12.5px]"
                >
                  <option value="Crítica">Crítica</option>
                  <option value="Alta">Alta</option>
                  <option value="Média">Média</option>
                  <option value="Baixa">Baixa</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-[var(--ink-3)] block mb-1">Afetados</label>
                <select
                  value={affectedScope}
                  onChange={(e) => setAffectedScope(e.target.value as AffectedScope)}
                  className="w-full h-8 px-2 rounded-md border border-[#1B243124] text-[12.5px]"
                >
                  <option value="Somente você">Somente você</option>
                  <option value="Minha equipe">Minha equipe</option>
                  <option value="Toda a empresa">Toda a empresa</option>
                  <option value="Não sei">Não sei</option>
                </select>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-[18px] font-semibold tracking-[-0.2px] text-[var(--ink)] leading-[23px]">
              {draft.title}
            </div>
            <div className="text-[13.5px] text-[var(--ink-2)] leading-[20px]">
              {draft.description}
            </div>
          </>
        )}
      </div>

      {/* Fields Grid (matches nexo.pen Confirmation Card) */}
      {!editing && (
        <div className="px-[18px] pb-4">
        <div className="border-t border-[var(--rule)] pt-3 grid grid-cols-3 gap-6 bg-[var(--paper)]">
          <div>
            <div className="text-[12px] text-[var(--ink-3)]">Categoria</div>
            <div className="text-[14.5px] font-medium text-[var(--ink)] mt-1">
              {draft.category}
            </div>
          </div>
          <div>
            <div className="text-[12px] text-[var(--ink-3)]">Prioridade</div>
            <div className="text-[14.5px] font-medium text-[var(--ink)] mt-1 flex items-center gap-1.5 flex-wrap">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  draft.priority === 'Crítica'
                    ? 'bg-[var(--danger)]'
                    : draft.priority === 'Alta'
                      ? 'bg-[var(--warning)]'
                      : 'bg-[var(--primary)]'
                }`}
              />
              <span>{draft.priority}</span>
              <span className="text-[12.5px] text-[var(--ink-3)] font-normal">
                {draft.slaDueLabel}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-[var(--ink-3)]">Afetados</div>
            <div className="text-[14.5px] font-medium text-[var(--ink)] mt-1">
              {draft.affectedScope}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Actions Footer */}
      {isPending && (
        <div className="h-[68.5px] shrink-0 box-border px-2 py-2 pr-3.5 bg-[var(--desk)] border-t border-[var(--rule)] flex items-center gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveEdit}
                className="h-9 px-3.5 rounded-[8px] bg-[var(--cta)] text-white text-[13.5px] font-semibold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer"
              >
                Salvar alterações
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-9 px-3.5 rounded-[8px] text-[13.5px] font-medium text-[var(--ink-2)] hover:bg-[#1B24310D] cursor-pointer"
              >
                Voltar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onConfirm(draft.id)}
                className="h-9 pl-3.5 pr-2.5 rounded-[8px] bg-[var(--cta)] text-white text-[13.5px] font-semibold flex items-center gap-2 hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <span>Confirmar</span>
                <span className="px-1.5 py-0.5 rounded-[5px] bg-[#FFFFFF24] text-[#FFFFFFCC] text-[11px] font-normal">
                  ⌘↵
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                className="h-9 px-3.5 rounded-[8px] bg-[var(--paper)] border border-[#1B24311F] text-[13.5px] font-medium text-[var(--ink)] hover:bg-[#1B243108] transition-colors cursor-pointer"
              >
                Editar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onCancel(draft.id)}
                className="h-9 px-3.5 rounded-[8px] text-[13.5px] font-medium text-[var(--ink-2)] hover:bg-[#1B24310D] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
