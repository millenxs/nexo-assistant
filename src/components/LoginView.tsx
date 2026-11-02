'use client';

import React, { useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, KeyRound, Mail, Headset } from './Icons';
import { Analyst, Employee } from '@/domain/types';
import { NexoMark } from './NexoMark';

export function LoginView({
  employees,
  analysts,
  onLoginEmployee,
  onLoginAnalyst,
}: {
  employees: Employee[];
  analysts: Analyst[];
  onLoginEmployee: (employee: Employee) => void;
  onLoginAnalyst: (analyst: Analyst) => void;
}) {
  const [email, setEmail] = useState('ana.souza@nexo.com.br');
  const [password, setPassword] = useState('••••••••••');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loginWithEmail = async (targetEmail: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Falha ao autenticar.');
      } else if (data.role === 'employee') {
        onLoginEmployee(data.employee);
      } else if (data.role === 'analyst') {
        onLoginAnalyst(data.analyst);
      }
    } catch {
      setError('Erro de conexão ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await loginWithEmail(email);
  };

  return (
    <div className="min-h-screen w-full bg-[var(--paper)] flex flex-col lg:flex-row">
      {/* Left Showcase Panel (800px on 1440px desktop, fill=$ink) */}
      <div className="lg:w-[55.5%] xl:w-[800px] shrink-0 bg-[var(--ink)] text-white px-10 lg:px-16 pt-10 pb-12 flex flex-col justify-between min-h-[640px]">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <NexoMark size={24} color="#FFFFFF" />
          <span className="text-[17px] font-bold tracking-[-0.2px]">Nexo Assist</span>
        </div>

        {/* Story + Conversation Preview */}
        <div className="my-10 space-y-9">
          <div className="space-y-4">
            <div className="text-[13.5px] font-medium text-[#FFFFFF8C]">
              Service desk de TI da Nexo
            </div>
            <h1 className="font-display text-[44px] xl:text-[54px] leading-[1.04] tracking-[-1.2px] text-white max-w-[640px]">
              Seu problema de TI, resolvido em uma conversa.
            </h1>
            <p className="text-[16px] leading-[1.55] text-[#FFFFFFA6] max-w-[520px]">
              Descreva o que está acontecendo. O assistente consulta seus chamados, busca na
              central de ajuda e chama um analista quando precisa.
            </p>
          </div>

          {/* Preview Wrap (indented left 96px on desktop per nexo.pen) */}
          <div className="lg:pl-24">
            <div className="w-full max-w-[500px] rounded-[16px] bg-[#FFFFFF0A] border border-[#FFFFFF14] p-[18px] space-y-2.5">
              {/* User message */}
              <div className="flex justify-end">
                <div className="bg-[var(--paper)] text-[var(--ink)] text-[13.5px] px-3.5 py-2 rounded-tl-[12px] rounded-tr-[12px] rounded-bl-[12px] rounded-br-[4px]">
                  Meu notebook não conecta na VPN. Erro 809.
                </div>
              </div>

              {/* Agent message */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <span className="font-semibold text-[#FFFFFFCC]">Nexo Assist</span>
                  <span className="text-[#FFFFFF73]">
                    consultou seus chamados · criou um chamado
                  </span>
                </div>
                <div className="w-full max-w-[380px] bg-[#FFFFFF14] text-white text-[13.5px] leading-[1.5] px-3.5 py-2.5 rounded-tl-[4px] rounded-tr-[12px] rounded-bl-[12px] rounded-br-[12px]">
                  Pronto: abri o chamado com prioridade alta. Um analista fala com você em até
                  4 h úteis.
                </div>
                <div className="inline-flex items-center gap-2 bg-[var(--paper)] rounded-[12px] px-3 py-[7px]">
                  <span className="w-[7px] h-[7px] rounded-full bg-[var(--warning)]" />
                  <span className="text-[12.5px] font-semibold text-[var(--ink)] font-data">
                    INC-20517
                  </span>
                  <span className="text-[12.5px] text-[var(--ink-3)]">
                    Rede e VPN · Alta · em até 4 h
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Footer */}
        <div className="pt-6 border-t border-[#FFFFFF1A] grid grid-cols-3 gap-6">
          <div className="space-y-1.5">
            <div className="font-display text-[34px] tracking-[-0.6px] leading-none text-white">
              8 s
            </div>
            <div className="text-[13.5px] text-[#FFFFFF8C]">
              primeira resposta, em média
            </div>
          </div>

          <div className="pl-6 border-l border-[#FFFFFF1A] space-y-1.5">
            <div className="font-display text-[34px] tracking-[-0.6px] leading-none text-white">
              72%
            </div>
            <div className="text-[13.5px] text-[#FFFFFF8C]">resolvidos sem fila</div>
          </div>

          <div className="pl-6 border-l border-[#FFFFFF1A] space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-display text-[34px] tracking-[-0.6px] leading-none text-white">
                6
              </span>
              <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
            </div>
            <div className="text-[13.5px] text-[#FFFFFF8C]">analistas online agora</div>
          </div>
        </div>
      </div>

      {/* Right Sign In Panel */}
      <div className="flex-1 flex flex-col justify-between px-8 lg:px-14 py-10">
        {/* Top Help */}
        <div className="flex items-center justify-end gap-1.5 text-[13.5px]">
          <span className="text-[var(--ink-3)]">Problema para entrar?</span>
          <a
            href="#ramal-4000"
            onClick={(e) => {
              e.preventDefault();
              setEmail('ana.souza@nexo.com.br');
            }}
            className="font-semibold text-[var(--primary-text)] hover:underline"
          >
            Ligue no ramal 4000
          </a>
        </div>

        {/* Center Form (380px width per nexo.pen) */}
        <div className="w-full max-w-[380px] mx-auto space-y-7 my-8">
          <div className="space-y-2">
            <h2 className="font-display text-[40px] leading-[1.1] tracking-[-0.8px] text-[var(--ink)]">
              Entrar
            </h2>
            <p className="text-[15.5px] leading-[1.5] text-[var(--ink-3)]">
              Use seu e-mail corporativo e a senha da rede Nexo.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-[18px]">
            {/* E-mail corporativo */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13.5px] font-medium text-[var(--ink)]">
                  E-mail corporativo
                </label>
              </div>
              <div className="h-[44px] px-3.5 rounded-[8px] bg-[var(--paper)] border border-[#1B24311F] focus-within:border-[var(--cta)] focus-within:border-[1.5px] flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-[var(--ink-3)] shrink-0" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.nome@nexo.com.br"
                  className="w-full text-[14.5px] text-[var(--ink)] bg-transparent focus:outline-none"
                  required
                />
              </div>
            </div>

            {/* Senha */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[13.5px] font-medium text-[var(--ink)]">Senha</label>
                <button
                  type="button"
                  onClick={() => setPassword('nexo2026')}
                  className="text-[13.5px] font-medium text-[var(--primary-text)] hover:underline cursor-pointer"
                >
                  Esqueci minha senha
                </button>
              </div>
              <div className="h-[44px] pl-3.5 pr-2 rounded-[8px] bg-[var(--paper)] border-[1.5px] border-[var(--cta)] flex items-center gap-2.5">
                <KeyRound className="w-4 h-4 text-[var(--primary-text)] shrink-0" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-[14.5px] text-[var(--ink)] bg-transparent focus:outline-none tracking-wider"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="w-[30px] h-[30px] rounded-[6px] flex items-center justify-center text-[var(--ink-3)] hover:bg-[var(--desk)] cursor-pointer"
                  aria-label="Alternar visibilidade da senha"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember */}
            <label className="flex items-center gap-2.5 pt-0.5 cursor-pointer select-none">
              <button
                type="button"
                onClick={() => setRemember((v) => !v)}
                className={`w-[18px] h-[18px] rounded-[6px] flex items-center justify-center transition-colors ${
                  remember ? 'bg-[var(--cta)] text-white' : 'border border-[#1B243133] bg-white'
                }`}
              >
                {remember && <Check className="w-3 h-3 stroke-[3]" />}
              </button>
              <span className="text-[13.5px] text-[var(--ink-2)]">
                Manter conectado neste computador
              </span>
            </label>

            {error && (
              <div className="p-3 rounded-[8px] bg-[var(--danger-soft)] text-[var(--danger-text)] text-[13px]">
                {error}
              </div>
            )}

            {/* Entrar CTA */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-[44px] rounded-[8px] bg-[var(--cta)] hover:bg-[var(--primary-hover)] text-white text-[15.5px] font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>{loading ? 'Entrando…' : 'Entrar'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Demo Accounts Quick Switch (Note section in nexo.pen) */}
          <div className="pt-4 border-t border-[var(--rule)] space-y-2.5">
            <div className="text-[12px] font-medium text-[var(--ink-3)]">
              Acesso rápido para avaliação (qualquer senha é aceita):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {employees.slice(0, 4).map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setEmail(emp.email);
                    loginWithEmail(emp.email);
                  }}
                  className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors cursor-pointer ${
                    email === emp.email
                      ? 'bg-[var(--primary-soft)] border-[#0285F740] text-[var(--primary-text)] font-semibold'
                      : 'bg-[var(--desk)] border-[var(--rule)] text-[var(--ink-2)] hover:bg-[#1B24310D]'
                  }`}
                >
                  {emp.name} ({emp.os})
                </button>
              ))}
            </div>

            {analysts[0] && (
              <button
                type="button"
                disabled={loading}
                onClick={() => loginWithEmail(analysts[0]!.email)}
                className="w-full h-9 px-3 rounded-[8px] bg-[var(--desk)] hover:bg-[#1B243112] border border-[var(--rule)] text-[12.5px] font-semibold text-[var(--ink)] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Headset className="w-3.5 h-3.5 text-[var(--cta)]" />
                <span>Entrar direto no Console do Analista ({analysts[0].name} · {analysts[0].tier})</span>
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[12.5px] text-[var(--ink-3)]">
          <span>© 2026 Nexo · Service desk de TI</span>
          <span>Privacidade e uso de dados</span>
        </div>
      </div>
    </div>
  );
}
