import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import {
  createProduct,
  getProduct,
  duplicateProduct,
  deleteProduct,
  listFilteredStoreProducts,
  countFilteredStoreProducts,
} from '../../src/features/products/db.ts';
import {
  replaceProductCheckoutFields,
  listProductCheckoutFields,
} from '../../src/features/products/customFieldsDb.ts';
import { saveCartLineInputs, getCartLineInputsByPublicIds } from '../../src/features/cart/inputsDb.ts';
import { cartKey, parseCartKey } from '../../src/features/cart/key.ts';
import { reserveInventory, releaseExpiredReservations } from '../../src/features/orders/reservations.ts';
import { reservationItems } from '../../src/features/orders/reservationItems.ts';
import { recordPaidOrder, getOrder } from '../../src/features/orders/db.ts';
import { parseStoredCustomerInputs } from '../../src/features/products/customFields.ts';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});

try {
  const db = await mf.getD1Database('DB');
  const migrationFiles = readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    const raw = readFileSync(join('migrations', file), 'utf8');
    const stripped = raw
      .split('\n')
      .map((line) => line.replace(/--.*$/, '').trim())
      .filter(Boolean)
      .join(' ');
    if (stripped) {
      await db.exec(stripped);
    }
  }

  // 1. Database-level CHECK constraint rejects 'password' field type
  const prodId = await createProduct(db, {
    name: 'اشتراک ChatGPT Plus',
    slug: 'chatgpt-plus',
    description: 'فعال‌سازی رسمی روی ایمیل شما',
    price_cents: 1200000,
    currency: 'usd',
    image_key: null,
    stock: 0,
    active: 1,
    weight_grams: null,
    requires_shipping: 0,
    short_description: 'تحویل آنی تا ۳۰ دقیقه',
    brand: 'OpenAI',
    region: 'Global',
    badge: 'پرفروش',
    is_featured: 1,
    display_order: 1,
    faq_json: JSON.stringify([{ q: 'نیاز به رمز عبور هست؟', a: 'خیر، فقط ایمیل اکانت کافی است.' }]),
    instructions: 'ایمیل حساب خود را بدون فاصله وارد کنید.',
    seo_title: 'خرید اشتراک ChatGPT Plus',
    seo_description: 'فعال‌سازی امن اشتراک هوش مصنوعی',
    compare_price_cents: 1500000,
    estimated_delivery: '۱۵ تا ۳۰ دقیقه',
  });

  await assert.rejects(
    async () => {
      await db
        .prepare(
          `INSERT INTO product_checkout_fields (public_id, product_id, field_key, label, field_type)
           VALUES ('pfld_bad0000001', ?, 'acct_pwd', 'رمز عبور', 'password')`,
        )
        .bind(prodId)
        .run();
    },
    /CHECK constraint failed/i,
    'D1 CHECK constraint must block password field type',
  );

  // 2. Replace & list custom checkout fields
  await replaceProductCheckoutFields(db, prodId, [
    {
      public_id: null,
      field_key: 'account_email',
      label: 'ایمیل اکانت',
      field_type: 'email',
      placeholder: 'name@example.com',
      help_text: 'ایمیل متصل به OpenAI',
      options: [],
      is_required: 1,
      min_length: null,
      max_length: 120,
      sort_order: 0,
      is_active: 1,
    },
  ]);
  const fields = await listProductCheckoutFields(db, prodId);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].field_key, 'account_email');

  // 3. Filtered store catalog query & counts
  const filtered = await listFilteredStoreProducts(
    db,
    { featuredOnly: true, discountedOnly: true, searchQuery: 'OpenAI' },
    10,
    0,
  );
  assert.equal(filtered.length, 1);
  assert.equal(await countFilteredStoreProducts(db, { featuredOnly: true }), 1);

  // 4. Duplicate product creates inactive draft (active = 0) copying custom checkout fields
  const dupId = await duplicateProduct(db, prodId);
  assert(dupId);
  const dup = await getProduct(db, dupId);
  assert.equal(dup?.active, 0);
  const dupFields = await listProductCheckoutFields(db, dupId);
  assert.equal(dupFields.length, 1);

  // 5. Same product with different custom inputs splits into distinct cart lines
  const product = await getProduct(db, prodId);
  assert(product?.public_id);
  const sid = 'csid_1234567890';
  const tokA = await saveCartLineInputs(db, sid, product.public_id, [
    { key: 'account_email', label: 'ایمیل اکانت', type: 'email', value: 'first@example.com' },
  ]);
  const tokB = await saveCartLineInputs(db, sid, product.public_id, [
    { key: 'account_email', label: 'ایمیل اکانت', type: 'email', value: 'second@example.com' },
  ]);
  const keyA = cartKey(product.public_id, null, [], tokA);
  const keyB = cartKey(product.public_id, null, [], tokB);
  assert.notEqual(keyA, keyB);
  assert.equal(parseCartKey(keyA)?.inputPublicId, tokA);

  const loadedInputs = await getCartLineInputsByPublicIds(db, sid, [tokA, tokB]);
  assert.equal(loadedInputs.get(tokA)?.[0]?.value, 'first@example.com');
  assert.equal(loadedInputs.get(tokB)?.[0]?.value, 'second@example.com');

  // 6. Digital product with stock = 0 succeeds in reservation + settlement and NEVER creates stock exceptions
  const rItems = reservationItems([
    {
      product,
      variantId: null,
      name: product.name,
      qty: 1,
      unitPriceCents: product.price_cents,
      customerInputs: loadedInputs.get(tokA),
    },
  ]);
  assert.equal(rItems[0].trackInventory, false);

  const reservationId = 'res_digital0001';
  const reserved = await reserveInventory(db, reservationId, rItems, 600, 'demo');
  assert.equal(reserved, true, 'Digital product with stock=0 must reserve without shortfall');

  await releaseExpiredReservations(db);
  const orderId = await recordPaidOrder(db, {
    providerSessionId: 'demo_sess_1',
    reservationId,
    email: 'buyer@example.com',
    amountTotalCents: product.price_cents,
    shippingCents: 0,
    shippingLabel: null,
    shippingWeightGrams: null,
    deliveryMethod: null,
    discountCents: 0,
    taxCents: 0,
    currency: 'usd',
    shippingAddress: null,
    paymentMethod: 'demo',
    items: rItems,
  });

  // 7. Stock stayed 0 (not decremented negative) and no inventory exception logged
  const productAfter = await getProduct(db, prodId);
  assert.equal(productAfter?.stock, 0);
  const exceptionsRow = await db.prepare('SELECT COUNT(*) AS n FROM order_inventory_exceptions').first();
  assert.equal(exceptionsRow?.n, 0);

  // 8. Mutating/deleting product_checkout_fields AFTER checkout leaves order item snapshot intact
  await replaceProductCheckoutFields(db, prodId, []);
  const orderRow = await getOrder(db, orderId);
  assert(orderRow);
  const { results: orderItems } = await db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all();
  assert.equal(orderItems.length, 1);
  const snapshot = parseStoredCustomerInputs(orderItems[0].customer_inputs_json);
  assert.deepEqual(snapshot, [
    { key: 'account_email', label: 'ایمیل اکانت', type: 'email', value: 'first@example.com' },
  ]);

  // 9. Deleting the product cleanly detaches order_items.product_id while preserving order item snapshots
  await deleteProduct(db, prodId);
  assert.equal(await getProduct(db, prodId), null);
  const { results: orderItemsAfterDelete } = await db
    .prepare('SELECT * FROM order_items WHERE order_id = ?')
    .bind(orderId)
    .all();
  assert.equal(orderItemsAfterDelete.length, 1);
  assert.equal(orderItemsAfterDelete[0].product_id, null);
  assert.deepEqual(parseStoredCustomerInputs(orderItemsAfterDelete[0].customer_inputs_json), [
    { key: 'account_email', label: 'ایمیل اکانت', type: 'email', value: 'first@example.com' },
  ]);

  console.log('phase1-digital integration tests: ok');
} finally {
  await mf.dispose();
}
