import { NextRequest, NextResponse } from 'next/server';
import { resetDbWithSeeds } from '@/services/db';
import { ticketService } from '@/services/ticket-service';
import { kbService } from '@/services/kb-service';

export async function GET() {
  return NextResponse.json({
    legacyMode: ticketService.getLegacyInstabilityMode(),
    articles: kbService.getAllArticles(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: 'set-legacy-mode' | 'reset-seeds';
      mode?: '0' | 'transient' | 'down';
    };

    if (body.action === 'set-legacy-mode' && body.mode) {
      ticketService.setLegacyInstabilityMode(body.mode);
      return NextResponse.json({
        legacyMode: ticketService.getLegacyInstabilityMode(),
      });
    }

    if (body.action === 'reset-seeds') {
      resetDbWithSeeds();
      return NextResponse.json({
        ok: true,
        legacyMode: ticketService.getLegacyInstabilityMode(),
      });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro no controle do sistema.' },
      { status: 500 }
    );
  }
}
