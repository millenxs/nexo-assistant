import { NextRequest, NextResponse } from 'next/server';
import { conversationService } from '@/services/conversation-service';
import { ticketService } from '@/services/ticket-service';
import { getServerModelConfig } from '@/mastra/model-provider';

export async function GET() {
  const employees = conversationService.listEmployees();
  const analysts = conversationService.listAnalysts();
  const modelConfig = getServerModelConfig();
  const legacyMode = ticketService.getLegacyInstabilityMode();

  return NextResponse.json({
    employees,
    analysts,
    modelConfig,
    legacyMode,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = (body.email ?? '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: 'Informe seu e-mail corporativo (@nexo.com.br).' },
        { status: 400 }
      );
    }

    const employee = conversationService.getEmployeeByEmail(email);
    if (employee) {
      return NextResponse.json({
        role: 'employee',
        employee,
      });
    }

    const analyst = conversationService.getAnalystByEmailOrId(email);
    if (analyst) {
      return NextResponse.json({
        role: 'analyst',
        analyst,
      });
    }

    return NextResponse.json(
      {
        error:
          'E-mail corporativo não encontrado nos colaboradores de exemplo da Nexo. Selecione um colaborador abaixo ou use ana.souza@nexo.com.br.',
      },
      { status: 404 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro interno na autenticação.' },
      { status: 500 }
    );
  }
}
