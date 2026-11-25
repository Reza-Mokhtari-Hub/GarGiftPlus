import { env } from 'cloudflare:workers';
import type { AstroCookies } from 'astro';
import { getConfig } from '../../config';
import { getSetting } from '../settings/db';
import { getEmailProvider } from '../email';
import { loginLinkEmail } from '../email/loginLink';
import { signToken, verifyToken } from './token';
import {
  ensureCustomerByEmail,
  type CustomerAccount,
} from '../customers/accountsDb';

/**
 * Passwordless customer auth (magic-link). Default adapter for the storefront
 * "accounts" feature — no passwords stored, so no hashing/reset/breach liability.
 * Reuses the signed-token primitive (token.ts) for both the login link and the
 * session cookie, and the EmailProvider seam to deliver the link.
 */
const MAGIC_TTL = 15 * 60; // login link valid 15 min
const SESSION_TTL = 30 * 24 * 3600; // session cookie valid 30 days
const COOKIE = 'customer_session';
export const SESSION_UI_HINT_COOKIE = 'gg_has_session';

const now = () => Date.now() / 1000;
const normalize = (email: string) => email.trim().toLowerCase();

/**
 * Accounts are usable when the feature is on AND the signing secret is set.
 * We do NOT block the customer account area when an external email API key is not
 * yet configured; email delivery is used when configured, and local/preview
 * environments can verify the signed magic link directly.
 */
export async function accountsEnabled(): Promise<boolean> {
  const override = await getSetting(env.DB, 'accounts_enabled');
  const on = override == null ? getConfig().features.accounts : override === '1';
  return Boolean(on && env.AUTH_SECRET);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export interface RequestLoginResult {
  sentViaEmail: boolean;
  verifyUrl: string | null;
}

/**
 * Email a magic sign-in link and ensure a persistent customer record exists.
 */
export async function requestLogin(
  email: string,
  origin: string,
): Promise<RequestLoginResult> {
  const secret = env.AUTH_SECRET;
  if (!secret) return { sentViaEmail: false, verifyUrl: null };
  const addr = normalize(email);
  const token = await signToken(addr, secret, MAGIC_TTL, now());
  const link = `${origin}/account/verify?token=${encodeURIComponent(token)}`;

  try {
    await ensureCustomerByEmail(env.DB, addr, false);
  } catch (err) {
    console.error('Customer pre-registration warning:', err);
  }

  if (import.meta.env.DEV) console.log(`[magic-link] ${addr} → ${link}`);

  const emailer = await getEmailProvider();
  if (emailer) {
    try {
      const storeName = (await getSetting(env.DB, 'store_name')) || getConfig().storeName;
      await emailer.send(loginLinkEmail(addr, link, storeName));
      return { sentViaEmail: true, verifyUrl: import.meta.env.DEV ? link : null };
    } catch (err) {
      console.error('Login email failed:', err);
    }
  }
  return { sentViaEmail: false, verifyUrl: import.meta.env.DEV ? link : null };
}

/** Verify a magic-link token → the email it was issued for, or null. */
export async function verifyLoginToken(token: string | null): Promise<string | null> {
  const secret = env.AUTH_SECRET;
  if (!secret) return null;
  return verifyToken(token, secret, now());
}

/** Issue the signed session cookie for a verified email and touch customer login. */
export async function setCustomerSession(
  cookies: AstroCookies,
  email: string,
  secure: boolean,
): Promise<void> {
  const secret = env.AUTH_SECRET;
  if (!secret) return;
  const addr = normalize(email);
  const ttlRaw = Number((await getSetting(env.DB, 'customer_session_ttl_days')) ?? '');
  const ttlSeconds =
    Number.isSafeInteger(ttlRaw) && ttlRaw >= 1 && ttlRaw <= 180 ? ttlRaw * 24 * 3600 : SESSION_TTL;
  const token = await signToken(addr, secret, ttlSeconds, now());
  cookies.set(COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds,
  });
  cookies.set(SESSION_UI_HINT_COOKIE, '1', {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds,
  });
  try {
    await ensureCustomerByEmail(env.DB, addr, true);
  } catch (err) {
    console.error('Failed to update customer login timestamp:', err);
  }
}

export function clearCustomerSession(cookies: AstroCookies): void {
  cookies.delete(COOKIE, { path: '/' });
  cookies.delete(SESSION_UI_HINT_COOKIE, { path: '/' });
}

/** The logged-in customer's email (verified session cookie), or null. */
export async function getCustomerEmail(cookies: AstroCookies): Promise<string | null> {
  const secret = env.AUTH_SECRET;
  if (!secret) return null;
  return verifyToken(cookies.get(COOKIE)?.value ?? null, secret, now());
}

/** Resolve the verified CustomerAccount row from the signed session cookie (null if suspended). */
export async function getVerifiedCustomer(
  cookies: AstroCookies,
): Promise<CustomerAccount | null> {
  const email = await getCustomerEmail(cookies);
  if (!email) return null;
  const customer = await ensureCustomerByEmail(env.DB, email, false);
  if (customer.status === 'suspended') {
    clearCustomerSession(cookies);
    return null;
  }
  return customer;
}
