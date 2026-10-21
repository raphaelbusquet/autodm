export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  IG_APP_ID: string;
  IG_APP_SECRET: string;
  // Meta app secret (Configurações → Básico). Webhooks may be signed with it instead of the Instagram app secret.
  META_APP_SECRET?: string;
  IG_VERIFY_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CONTACT_EMAIL: string;
  // Ebook site: POST endpoint that issues 24h welcome-price links, and its admin token (secret).
  EBOOK_OFFER_URL?: string;
  EBOOK_OFFER_TOKEN?: string;
  EBOOK?: Fetcher;
  // Service binding to this same Worker, used to fan work out into separate invocations.
  SELF?: Fetcher;
  // Optional overrides, used by local tests to point at a mock server.
  IG_GRAPH_BASE?: string;
  YT_API_BASE?: string;
  GOOGLE_TOKEN_URL?: string;
}

export type Platform = 'instagram' | 'youtube';
export type Trigger = 'comment' | 'dm';

export interface Rule {
  id: number;
  name: string;
  platform: Platform;
  trigger: Trigger;
  media_ids: string[];
  keywords: string[];
  match_mode: 'contains' | 'exact';
  public_replies: string[];
  dm_text: string;
  button_label: string;
  require_follow: boolean;
  not_following_text: string;
  follow_button_label: string;
  still_not_following_text: string;
  link_text: string;
  wait_text: string;
  link_delay_minutes: number;
  link_url: string;
  link_button_label: string;
  active: boolean;
  priority: number;
}
