/** Types for `landing-router.mjs`. */
export const SCENARIO_COOKIE: string;
export const ATTR_COOKIE: string;
export const SCENARIO_HEADER: string;
export const STICKY_MAX_AGE_S: number;

export interface Attribution {
  scenario: string;
  reason: string;
  param?: string;
  value?: string | null;
  utm?: Record<string, string>;
  referrer?: string | null;
  at?: string;
}

export interface RouterCookie {
  name: string;
  value: string;
  maxAge: number;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
}

export function encodeAttribution(attr: Attribution): string;
export function decodeAttribution(value: string | null | undefined): Attribution | null;

export function routeLanding(
  req: {
    query: URLSearchParams;
    scenarioCookie?: string | null;
    attrCookie?: string | null;
    referer?: string | null;
    secure?: boolean;
  },
  env: Record<string, string | undefined>,
  deps?: { random?: () => number; now?: () => Date },
):
  | { ok: false; error: string }
  | {
      ok: true;
      scenario: string;
      reason: string;
      assigned: boolean;
      cookies: RouterCookie[];
      attribution: Attribution | null;
    };

export function runAttribution(attrCookie: string | null | undefined, scenarioId: string): Attribution;
