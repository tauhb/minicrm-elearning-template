/**
 * services/ai-providers.ts — Registry of all AI providers CRM can talk to.
 *
 * The 5 new providers (Groq/OpenRouter/Kimi/Qwen/DeepSeek) are all OpenAI-compatible
 * REST APIs — one adapter, N configs. Adding a provider = new entry here.
 * openai-codex stays as a special case (OAuth device flow + Codex-specific headers).
 *
 * Adding a provider — check-list:
 *   1. Append an entry below with { base_url, default_model, auth_type, docs_url }.
 *   2. If it deviates from OpenAI Chat Completions in a subtle way (e.g. Qwen model
 *      naming, DeepSeek "reasoner" stream events), add a `quirks` field and handle in
 *      services/ai-router.ts. Otherwise no code change needed.
 */

export type AuthType = 'oauth-device' | 'api-key'

export interface ProviderConfig {
  id: string                    // e.g. 'groq' — matches provider_credentials.provider
  label: string                 // Vietnamese display name
  auth_type: AuthType
  base_url: string              // Full base incl. /v1 for OpenAI-compat REST
  default_model: string
  suggested_models: string[]    // Rendered in Settings model picker (falls back to /models endpoint)
  docs_url: string              // Where user creates the API key
  supports_streaming: boolean
  supports_embeddings: boolean
  embedding_model?: string      // If it also serves embeddings (used by KB/RAG in Sprint B)
  embedding_dim?: number
  quirks?: {
    /** e.g. Codex requires stream:true. */
    force_stream?: boolean
    /** Some (like DeepSeek reasoner) emit reasoning tokens before the answer. */
    strip_reasoning?: boolean
    /** e.g. Codex requires store:false. */
    force_no_store?: boolean
  }
}

export const AI_PROVIDERS: Record<string, ProviderConfig> = {
  'openai-codex': {
    id: 'openai-codex',
    label: 'ChatGPT (Codex OAuth)',
    auth_type: 'oauth-device',
    base_url: 'https://chatgpt.com/backend-api/codex',
    default_model: 'gpt-5.6-sol',
    suggested_models: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.1', 'gpt-4o', 'o1'],
    docs_url: 'https://chatgpt.com/settings/authentication',
    supports_streaming: true,
    supports_embeddings: false,
    quirks: { force_stream: true, force_no_store: true },
  },
  'openai': {
    id: 'openai',
    label: 'OpenAI API',
    auth_type: 'api-key',
    base_url: 'https://api.openai.com/v1',
    default_model: 'gpt-4o',
    suggested_models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
    docs_url: 'https://platform.openai.com/api-keys',
    supports_streaming: true,
    supports_embeddings: true,
    embedding_model: 'text-embedding-3-small',
    embedding_dim: 1536,
  },
  'anthropic': {
    id: 'anthropic',
    label: 'Anthropic Claude API',
    auth_type: 'api-key',
    base_url: 'https://api.anthropic.com/v1',
    default_model: 'claude-opus-4-7',
    suggested_models: ['claude-opus-5', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    docs_url: 'https://console.anthropic.com/settings/keys',
    supports_streaming: true,
    supports_embeddings: false,
    // Anthropic isn't OpenAI-compat but we call via openai_compatible facade at anthropic.com/v1/chat/completions (they added it in 2025).
  },
  'groq': {
    id: 'groq',
    label: 'Groq (fastest inference)',
    auth_type: 'api-key',
    base_url: 'https://api.groq.com/openai/v1',
    default_model: 'llama-3.3-70b-versatile',
    suggested_models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'moonshotai/kimi-k2-instruct',
      'mixtral-8x7b-32768',
    ],
    docs_url: 'https://console.groq.com/keys',
    supports_streaming: true,
    supports_embeddings: false,
  },
  'openrouter': {
    id: 'openrouter',
    label: 'OpenRouter (aggregator)',
    auth_type: 'api-key',
    base_url: 'https://openrouter.ai/api/v1',
    default_model: 'anthropic/claude-opus-5',
    suggested_models: [
      'anthropic/claude-opus-5',
      'openai/gpt-5.6',
      'google/gemini-2.5-pro',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'moonshotai/kimi-k2',
    ],
    docs_url: 'https://openrouter.ai/keys',
    supports_streaming: true,
    supports_embeddings: false,
  },
  'kimi': {
    id: 'kimi',
    label: 'Kimi (Moonshot AI)',
    auth_type: 'api-key',
    base_url: 'https://api.moonshot.cn/v1',
    default_model: 'moonshot-v1-32k',
    suggested_models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    docs_url: 'https://platform.moonshot.cn/console/api-keys',
    supports_streaming: true,
    supports_embeddings: true,
    embedding_model: 'moonshot-v1-embed',
    embedding_dim: 1536,
  },
  'qwen': {
    id: 'qwen',
    label: 'Qwen (Alibaba DashScope)',
    auth_type: 'api-key',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    default_model: 'qwen-plus',
    suggested_models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct'],
    docs_url: 'https://dashscope.console.aliyun.com/apiKey',
    supports_streaming: true,
    supports_embeddings: true,
    embedding_model: 'text-embedding-v3',
    embedding_dim: 1024,
  },
  'deepseek': {
    id: 'deepseek',
    label: 'DeepSeek',
    auth_type: 'api-key',
    base_url: 'https://api.deepseek.com/v1',
    default_model: 'deepseek-chat',
    suggested_models: ['deepseek-chat', 'deepseek-reasoner'],
    docs_url: 'https://platform.deepseek.com/api_keys',
    supports_streaming: true,
    supports_embeddings: false,
    quirks: { strip_reasoning: true },
  },
  'gemini': {
    id: 'gemini',
    label: 'Google Gemini',
    auth_type: 'api-key',
    // Gemini has native OpenAI-compat mode at /v1beta/openai
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    default_model: 'gemini-2.5-flash',
    suggested_models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    docs_url: 'https://aistudio.google.com/apikey',
    supports_streaming: true,
    supports_embeddings: true,
    embedding_model: 'text-embedding-004',
    embedding_dim: 768,
  },
}

export function getProviderConfig(id: string): ProviderConfig {
  const cfg = AI_PROVIDERS[id]
  if (!cfg) throw new Error(`Unknown provider: ${id}. Registered: ${Object.keys(AI_PROVIDERS).join(', ')}`)
  return cfg
}

export function listProviderIds(): string[] {
  return Object.keys(AI_PROVIDERS)
}
