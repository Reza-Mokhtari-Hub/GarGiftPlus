import type { APIRoute } from 'astro';
import { handleBankTransferReceiptPost } from '../../../../features/payments/receiptUpload';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const result = await handleBankTransferReceiptPost(request, cookies, '/account/wallet');
  if ('badRequest' in result) {
    return new Response(result.badRequest, { status: 400 });
  }
  return redirect(result.redirectTo, 303);
};
