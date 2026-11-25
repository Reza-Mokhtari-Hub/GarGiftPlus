import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getVerifiedCustomer, SESSION_UI_HINT_COOKIE } from '../../features/auth/customer';
import { customerDisplayName, customerInitials } from '../../features/customers/accountsDb';
import { getOrCreateWalletByCustomerId } from '../../features/wallet/db';
import { formatMoney } from '../../money';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const customer = await getVerifiedCustomer(cookies);
  if (!customer) {
    cookies.delete(SESSION_UI_HINT_COOKIE, { path: '/' });
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    });
  }

  const wallet = await getOrCreateWalletByCustomerId(env.DB, customer.id);
  const displayName = customerDisplayName(customer, customer.email);
  const initials = customerInitials(customer, customer.email);

  return new Response(
    JSON.stringify({
      authenticated: true,
      email: customer.email,
      displayName,
      initials,
      walletBalance: wallet.balance,
      walletCurrency: wallet.currency,
      walletBalanceFormatted: formatMoney(wallet.balance, wallet.currency),
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    },
  );
};
