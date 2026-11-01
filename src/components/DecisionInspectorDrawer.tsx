'use client';

import React from 'react';
import {
  CheckCircle2,
  Cpu,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  AlertTriangle,
} from 'lucide-react';
import { DecisionTrace } from '@/domain/types';

export function DecisionInspectorDrawer({
  trace,
  onClose,
}: {
  trace: DecisionTrace | null;
  onClose: () => void;
}) {
  if (!trace) return null;

  const confidenceColor =
    trace.confidence >= 80
      ? 'text-[var(--success-text)] bg-[var(--success-soft)] border-[#00BD6C33]'
      : trace.confidence >= 60
        ? 'text-[var(--warning-text)] bg-[var(--warning-soft)] border-[#F5A50033]'
        : 'text-[var(--danger-text)] bg-[var(--danger-soft)] border-[#EE343B33]';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#1B24314D] backdrop-blur-[1px]">
      <div className="w-[480px] max-w-full h-full bg-[var(--paper)] border-l border-[var(--rule)] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="h-16 px-6 border-b border-[var(--rule)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--primary-soft)] flex items-center justify-center text-[var(--primary-text)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-[var(--ink)] leading-tight">
                Transparência da Decisão do Agent
              </h3>
              <p className="text-[12px] text-[var(--ink-3)] font-data">
                ID: {trace.id} · Motor: {trace.engine}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-[var(--desk)] flex items-center justify-center text-[var(--ink-2)] cursor-pointer"
            title="Fechar inspeção"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Grau de segurança + Intenção */}
          <div className="p-4 rounded-xl bg-[var(--desk)] border border-[var(--rule)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Grau de Segurança (Confiança)
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[12px] font-semibold border ${confidenceColor}`}
              >
                {trace.confidence}% · Segurança {trace.confidenceLevel}
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-[#1B243114] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  trace.confidence >= 80
                    ? 'bg-[var(--success)]'
                    : trace.confidence >= 60
                      ? 'bg-[var(--warning)]'
                      : 'bg-[var(--danger)]'
                }`}
                style={{ width: `${Math.min(100, Math.max(5, trace.confidence))}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="text-[11.5px] text-[var(--ink-3)]">Intenção detectada</div>
                <div className="text-[13px] font-semibold text-[var(--ink)] font-data">
                  {trace.intent}
                </div>
              </div>
              <div>
                <div className="text-[11.5px] text-[var(--ink-3)]">Escopo validado</div>
                <div className="text-[13px] font-semibold text-[var(--ink)]">
                  {trace.scope === 'TI' ? 'TI (Service Desk)' : `Redirecionado → ${trace.scope}`}
                </div>
              </div>
            </div>
          </div>

          {/* O que o agent fez e por quê */}
          <div className="space-y-2">
            <h4 className="text-[12.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5" />O que o agent entendeu e por que decidiu assim
            </h4>
            <div className="p-4 rounded-xl bg-[var(--paper)] border border-[var(--rule)] space-y-2">
              <div className="text-[13.5px] font-semibold text-[var(--ink)]">
                Ação tomada: {trace.actionTaken}
              </div>
              <p className="text-[13.5px] text-[var(--ink-2)] leading-relaxed">
                {trace.reasoning}
              </p>
            </div>
          </div>

          {/* Classificação do Chamado (se aplicável) */}
          {trace.classification && (
            <div className="space-y-2">
              <h4 className="text-[12.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)]">
                Classificação (Anexo A)
              </h4>
              <div className="grid grid-cols-2 gap-2.5 p-3.5 rounded-xl bg-[var(--desk)] border border-[var(--rule)] text-[13px]">
                {trace.classification.type && (
                  <div>
                    <span className="text-[var(--ink-3)] block text-[11.5px]">Tipo</span>
                    <span className="font-semibold text-[var(--ink)]">
                      {trace.classification.type === 'INC'
                        ? 'INC · Incidente'
                        : 'REQ · Requisição'}
                    </span>
                  </div>
                )}
                {trace.classification.category && (
                  <div>
                    <span className="text-[var(--ink-3)] block text-[11.5px]">Categoria</span>
                    <span className="font-semibold text-[var(--ink)]">
                      {trace.classification.category}
                    </span>
                  </div>
                )}
                {trace.classification.priority && (
                  <div>
                    <span className="text-[var(--ink-3)] block text-[11.5px]">Prioridade</span>
                    <span className="font-semibold text-[var(--ink)]">
                      {trace.classification.priority}
                    </span>
                  </div>
                )}
                {trace.classification.affectedScope && (
                  <div>
                    <span className="text-[var(--ink-3)] block text-[11.5px]">Afetados</span>
                    <span className="font-semibold text-[var(--ink)]">
                      {trace.classification.affectedScope}
                    </span>
                  </div>
                )}
                {trace.classification.slaLabel && (
                  <div className="col-span-2 pt-1 border-t border-[var(--rule)]">
                    <span className="text-[var(--ink-3)] block text-[11.5px]">Prazo (SLA)</span>
                    <span className="font-semibold text-[var(--ink)]">
                      {trace.classification.slaLabel}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ferramentas Mastra consultadas */}
          <div className="space-y-2">
            <h4 className="text-[12.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)] flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" />
              Ferramentas Mastra executadas ({trace.toolCalls.length})
            </h4>
            {trace.toolCalls.length === 0 ? (
              <div className="p-3 rounded-xl bg-[var(--desk)] text-[13px] text-[var(--ink-3)]">
                Decisão resolvida diretamente pelas guardrails de escopo/estado sem consulta externa.
              </div>
            ) : (
              <div className="space-y-2.5">
                {trace.toolCalls.map((tc, i) => (
                  <div
                    key={`${tc.toolId}-${i}`}
                    className="p-3.5 rounded-xl bg-[var(--paper)] border border-[var(--rule)] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-[var(--ink)] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
                        {tc.label}
                      </span>
                      <span className="text-[11.5px] font-data text-[var(--ink-3)]">
                        {tc.toolId} · {tc.durationMs}ms
                      </span>
                    </div>
                    <div className="text-[12.5px] text-[var(--ink-2)]">
                      <span className="font-medium text-[var(--ink-3)]">Resultado: </span>
                      {tc.outputSummary}
                    </div>
                    {tc.retriedLegacyError && (
                      <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--warning-text)] bg-[var(--warning-soft)] px-2.5 py-1 rounded-md">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Sistema legado oscilou na 1ª tentativa; recuperado automaticamente via retry.
                      </div>
                    )}
                    <div className="text-[11.5px] font-data text-[var(--ink-3)] bg-[var(--desk)] p-2 rounded-lg overflow-x-auto">
                      input: {JSON.stringify(tc.input)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Regras do Anexo A aplicadas */}
          <div className="space-y-2">
            <h4 className="text-[12.5px] font-semibold uppercase tracking-wider text-[var(--ink-3)] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              Regras determinísticas validadas
            </h4>
            <ul className="space-y-2">
              {trace.rulesApplied.map((rule, idx) => (
                <li
                  key={idx}
                  className="p-3 rounded-xl bg-[var(--desk)] border border-[var(--rule)] text-[13px] text-[var(--ink-2)] flex items-start gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
