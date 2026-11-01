import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';

export interface ModelConfigInfo {
  provider: 'openai' | 'google' | 'anthropic';
  modelId: string;
  hasApiKey: boolean;
}

export function getServerModelConfig(): ModelConfigInfo {
  const rawProvider = (process.env.LLM_PROVIDER || 'openai').toLowerCase();
  const provider: ModelConfigInfo['provider'] =
    rawProvider === 'google' || rawProvider === 'gemini'
      ? 'google'
      : rawProvider === 'anthropic' || rawProvider === 'claude'
        ? 'anthropic'
        : 'openai';

  if (provider === 'google') {
    return {
      provider: 'google',
      modelId: process.env.LLM_MODEL || 'gemini-2.5-flash',
      hasApiKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()),
    };
  }

  if (provider === 'anthropic') {
    return {
      provider: 'anthropic',
      modelId: process.env.LLM_MODEL || 'claude-3-5-haiku-latest',
      hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    };
  }

  return {
    provider: 'openai',
    modelId: process.env.LLM_MODEL || 'gpt-4o-mini',
    hasApiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

export function resolveMastraModel() {
  const cfg = getServerModelConfig();
  if (cfg.provider === 'google') {
    return google(cfg.modelId);
  }
  if (cfg.provider === 'anthropic') {
    return anthropic(cfg.modelId);
  }
  return openai(cfg.modelId);
}
