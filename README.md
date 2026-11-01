# Nexo Assist — Agent do Service Desk de TI

Protótipo funcional completo construído para o desafio técnico **Nexo Assist** (*Beyond the Bytes*), combinando atendimento conversacional com agente **Mastra**, consulta e gestão de chamados sem duplicidade, transferência com resumo para analistas (N1/N2) com pausa do agente e transparência completa das decisões em cada resposta.

---

## 1. Como rodar localmente

### Pré-requisitos
- **Node.js 22.5+** (testado com Node `v22.18.0`, utilizando SQLite nativo `node:sqlite` para persistência local sem necessidade de Docker ou compilação C++ externa).

### Passo a passo
```bash
# 1. Instalar dependências
npm install

# 2. (Opcional) Configurar variáveis de ambiente
cp .env.example .env

# 3. Rodar os testes automatizados (regras do Anexo A, isolamento de privacidade e fluxos E2E)
npm test

# 4. Iniciar o servidor de desenvolvimento
npm run dev
```

Acesse **`http://localhost:3000`** no navegador.

> **Nota sobre chaves de LLM (`.env`):**
> O projeto encapsula o provedor de LLM no servidor (`src/mastra/model-provider.ts`), aceitando `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` ou `ANTHROPIC_API_KEY`.
> **Para facilitar a avaliação imediata**, caso nenhuma chave de API seja informada no `.env`, o orquestrador opera automaticamente em modo **Híbrido Determinístico**, executando as mesmas ferramentas tipadas do Mastra (`createTool`) e aplicando 100% das regras do Anexo A com custo zero e resposta instantânea.

---

## 2. Credenciais e Cenários de Demonstração

Na tela de **Login** (`Tela 1`), qualquer senha é aceita para os colaboradores e analistas dos dados de exemplo (ou use os botões de acesso rápido no rodapé do formulário):

| Persona | E-mail | Papel / SO | O que testar com esta conta |
|---|---|---|---|
| **Ana Souza** | `ana.souza@nexo.com.br` | Financeiro · **Windows 11** | Fluxos das Telas 2 e 3 do `.pen`: erro 809 da VPN no Windows 11 (abre chamado com rascunho), consulta de 3 chamados abertos, chamado `INC-20311` com **prazo vencido** (há 5 dias) e chamado `INC-20150` (Senha do SAP) resolvido há 4 dias (**reabertura em até 7 dias**). |
| **Fábio Nunes** | `fabio.nunes@nexo.com.br` | Comercial · **Windows 10** | **Resolução sem fila:** erro 809 da VPN no Windows 10 é resolvido diretamente pelo artigo da Central de Ajuda sem precisar abrir chamado. |
| **Carla Mendes** | `carla.mendes@nexo.com.br` | Contabilidade · **Windows 11** | Chamado `REQ-10501` (SAP Fiscal) — útil para testar **Privacidade**: se Ana Souza tentar consultar o `REQ-10501`, o serviço bloqueia o acesso. |
| **Rafael Lima** | `rafael.lima@nexo.com.br` | **Analista — Suporte N2** | Acesso direto ao **Console do Analista** (Telas 4 e 5 do `.pen`): filtros (`Todas`, `Para você`, `Com o agent`, `Minhas`), assumir conversa com agent pausado, responder como analista, devolver ao agent ou encerrar. |

---

## 3. Visão Geral da Arquitetura

O projeto segue separação estrita de responsabilidades em 4 camadas dentro de `src/`:

```text
src/
├── domain/                  # Camada de Domínio Pura (zero dependência de LLM ou UI)
│   ├── types.ts             # Contratos estritos (Ticket, TicketDraft, Conversation, DecisionTrace)
│   ├── rules/
│   │   ├── priority-sla.ts  # Matriz determinística Impacto × Urgência e cálculo de SLA útil vs 24h
│   │   ├── ticket-rules.ts  # Validação de escopo (TI vs RH/Fin/Facilities), duplicidade e janela de 7 dias
│   │   └── conversation-state.ts # Máquina de estados da conversa e pausa do agente
│   └── __tests__/           # Testes unitários das regras do Anexo A
├── services/                # Persistência SQLite e Serviços de Negócio Independentes
│   ├── db.ts                # Schema SQLite (data/nexo.db) com persistência entre reinícios
│   ├── seed-data.ts         # Fixtures do Anexo B e estados ilustrativos do nexo.pen
│   ├── ticket-service.ts    # Interface ITicketService + simulação de instabilidade do sistema legado
│   ├── kb-service.ts        # Busca nos artigos da Central de Ajuda com restrição por SO
│   └── conversation-service.ts # Histórico, rascunhos, takeover do analista e sincronização
├── mastra/                  # Camada do Agente Mastra (@mastra/core)
│   ├── model-provider.ts    # Encapsulamento server-side do provedor LLM (OpenAI / Gemini / Anthropic)
│   ├── tools/               # Ferramentas tipadas com createTool() e schemas Zod
│   ├── agent.ts             # Definição do Agent Mastra e instruções do Service Desk
│   └── orchestrator.ts      # Orquestração conversacional, guardrails determinísticas e DecisionTrace
├── app/api/                 # Rotas REST separadas da interface (/api/auth, /api/chat, /api/drafts, /api/analyst, /api/system)
└── components/              # Interface Desktop fiel ao nexo.pen (Login, Chat, Cards, Console N2, Decision Inspector)
```

---

## 4. Como o Agent Decide o que Fazer e Garantia de Qualidade

Em vez de confiar em texto livre do LLM para regras críticas do negócio, o Nexo Assist separa **compreensão/condução conversacional** de **validação determinística**:

1. **Verificação de Estado e Limite da Sessão (`conversation-state.ts`):**
   - Antes de qualquer execução, o servidor verifica se a conversa está em `WAITING_ANALYST` ou `WITH_ANALYST`. Se estiver, a mensagem do funcionário é entregue ao Console do Analista, mas **o agente permanece estritamente pausado**.
   - Sessões são limitadas a **30 mensagens** (`18/30 mensagens nesta sessão`), prevenindo loops e custos inesperados de tokens.
2. **Filtro de Escopo (`evaluateScope`):**
   - Pedidos fora de TI (**RH**: férias/holerite; **Financeiro**: reembolso/nota fiscal; **Facilities**: ar-condicionado/mobiliário) são redirecionados imediatamente sem abrir chamado de TI.
   - O classificador diferencia ativos de TI de departamentos (ex.: *"Acesso à pasta Financeiro no SharePoint"* é reconhecido como demanda legítima de **TI › Acesso**).
3. **Prevenção de Duplicidade e Regra dos 7 Dias (`checkDuplicateOrReopenTool`):**
   - Antes de abrir um chamado, o agente consulta os chamados do próprio funcionário:
     - Se já existe chamado **aberto** sobre o mesmo problema (ex.: `INC-20311` de lentidão no notebook), propõe **atualizar** o chamado existente.
     - Se existe chamado **resolvido há até 7 dias** sobre o mesmo problema (ex.: `INC-20150` de senha do SAP resolvido há 4 dias), propõe **reabrir** o chamado.
4. **Resolução sem Fila vs. Restrição de Sistema Operacional (`searchHelpCenterTool`):**
   - Busca nos artigos da Central de Ajuda. No caso do **erro 809 de VPN**, o artigo resolve sem chamado apenas para **Windows 10**; como Ana Souza utiliza **Windows 11**, o agente explica essa regra e inicia a abertura do chamado.
5. **Coleta de Informações Faltantes e Matriz Impacto × Urgência (`evaluatePriorityAndSlaTool`):**
   - Se o funcionário ainda não informou quem é afetado, o agente pergunta **"Quem está sendo afetado?"** com opções rápidas (`1 Só eu`, `2 Minha equipe`, `3 Toda a empresa`, `4 Não sei`).
   - A prioridade e o SLA são calculados deterministicamente:
     - **Crítica (1 hora · plantão 24h):** incidente parando uma equipe ou toda a empresa.
     - **Alta (4 horas úteis):** impede uma pessoa de trabalhar ou há compromisso/reunião no mesmo dia (ex.: reunião às 14h).
     - **Média (3 dias úteis):** atrapalha, mas há alternativa.
     - **Baixa (5 dias úteis):** requisições (`REQ`) e pedidos sem urgência (ex.: segundo monitor para home office).
6. **Rascunho Obrigatório com Confirmação (`prepareTicketDraftTool` + `/api/drafts`):**
   - O agente **nunca** cria ou altera chamados diretamente no banco. Ele gera um rascunho (`Rascunho D-381`) com status `PENDING_CONFIRMATION`. O funcionário pode **Confirmar (`⌘↵`)**, **Editar** todos os campos inline ou **Cancelar**.
7. **Visibilidade das Decisões (`DecisionTrace` + `DecisionInspectorDrawer`):**
   - Acima de cada resposta do Nexo Assist aparecem os passos executados (`✓ consultou seus chamados`, `✓ buscou na central de ajuda`, `✓ classificou a prioridade`, `✓ montou o rascunho`) e o botão **`Ver decisão · X%`**.
   - Ao clicar, abre-se o painel lateral detalhando: intenção compreendida, escopo, barra de confiança (`%`), classificação completa, ferramentas Mastra invocadas (com input, output e latência em ms), regras do Anexo A aplicadas e justificativa em linguagem natural.

---

## 5. Resiliência ao Sistema Legado de Chamados

O PRD especifica que *"o sistema de chamados é legado e, de vez em quando, fica indisponível por alguns segundos"*.
- No topo da tela de Atendimento do funcionário há um botão interativo **`Sistema legado: Estável / Oscilando (Retry) / Indisponível (Timeout)`**:
  - **Oscilando (Retry):** simula falha transiente na 1ª tentativa do serviço legado com recuperação automática via retry e registra o aviso no inspetor de decisão.
  - **Indisponível (Timeout):** simula queda temporária do sistema legado; o agente captura `LegacySystemUnavailableError`, preserva o contexto da conversa, explica a situação de forma transparente e oferece tentar novamente ou transferir para um analista.

---

## 6. Principais Trade-offs e O que Faria com Mais Tempo

### Trade-offs adotados
- **SQLite nativo (`node:sqlite`) em vez de banco externo via Docker:** garante que conversas, chamados, rascunhos e estado de atendimento sobrevivam ao reinício da aplicação funcionando com apenas `npm install && npm run dev`.
- **Motor Híbrido (Mastra Agent + Regras Determinísticas):** garante que o projeto possa ser testado imediatamente mesmo sem chaves de API pagas configuradas, além de impedir alucinações em regras de SLA, privacidade e mutação de chamados.
- **Polling leve (2s) entre Chat do Funcionário e Console do Analista:** permite testar a transferência, o takeover do analista e a troca de mensagens em tempo real sem exigir servidor WebSocket customizado fora do Next.js.

### O que faria com mais tempo
1. **Streaming SSE / WebSockets dedicados** para eventos push instantâneos e indicador de digitação em tempo real entre funcionário e analista.
2. **Busca Híbrida (BM25 + Embeddings Vetoriais Locais)** na Central de Ajuda para ampliar a cobertura semântica de artigos extensos.
3. **Autenticação OIDC/SSO real com JWT assinado em cookie HTTP-Only** e controle de acesso baseado em papéis (RBAC N1 vs N2).
4. **Suite de Evals de Prompt automatizada** para medir precisão de classificação e taxa de resolução sem fila em centenas de conversas sintéticas.
