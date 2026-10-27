const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { createApp } = require('../src/app');

let app;
beforeEach(() => {
  app = createApp({ dbFile: ':memory:' }); // fresh database for every test
});

const createAccount = async (name = 'Alice') =>
  (await request(app).post('/accounts').send({ name })).body;

const addTx = (accountId, body) =>
  request(app).post(`/accounts/${accountId}/transactions`).send(body);

test('creates an account with balance 0', async () => {
  const res = await request(app).post('/accounts').send({ name: 'Alice' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.name, 'Alice');
  assert.strictEqual(res.body.balance, 0);
  assert.ok(res.body.id);
  assert.ok(res.body.created_at);
});

test('rejects missing name and client-set balance', async () => {
  const res = await request(app).post('/accounts').send({ balance: 500 });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  const fields = res.body.error.details.map((d) => d.field);
  assert.deepStrictEqual(fields.sort(), ['balance', 'name']);
});

test('rejects invalid JSON body', async () => {
  const res = await request(app)
    .post('/accounts')
    .set('Content-Type', 'application/json')
    .send('{bad json');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_JSON');
});

test('returns 404 for unknown account', async () => {
  const res = await request(app).get('/accounts/does-not-exist');
  assert.strictEqual(res.status, 404);
  const tx = await addTx('does-not-exist', { type: 'credit', amount: 10, reference_id: 'r1' });
  assert.strictEqual(tx.status, 404);
});

test('balance example from the assignment: 100 + 50 - 30 - 20 = 100', async () => {
  const acc = await createAccount();
  await addTx(acc.id, { type: 'credit', amount: 100, reference_id: 'r1' });
  await addTx(acc.id, { type: 'credit', amount: 50, reference_id: 'r2' });
  await addTx(acc.id, { type: 'debit', amount: 30, reference_id: 'r3' });
  const last = await addTx(acc.id, { type: 'debit', amount: 20, reference_id: 'r4' });
  assert.strictEqual(last.status, 201);
  assert.strictEqual(last.body.balance, 100);
  const bal = await request(app).get(`/accounts/${acc.id}/balance`);
  assert.strictEqual(bal.body.balance, 100);
});

test('handles decimal amounts without floating point errors', async () => {
  const acc = await createAccount();
  await addTx(acc.id, { type: 'credit', amount: 0.1, reference_id: 'r1' });
  const res = await addTx(acc.id, { type: 'credit', amount: 0.2, reference_id: 'r2' });
  assert.strictEqual(res.body.balance, 0.3);
});

test('validates type, amount and reference_id', async () => {
  const acc = await createAccount();
  const res = await addTx(acc.id, { type: 'refund', amount: -5 });
  assert.strictEqual(res.status, 400);
  const fields = res.body.error.details.map((d) => d.field).sort();
  assert.deepStrictEqual(fields, ['amount', 'reference_id', 'type']);

  const zero = await addTx(acc.id, { type: 'credit', amount: 0, reference_id: 'x' });
  assert.strictEqual(zero.status, 400);
  const str = await addTx(acc.id, { type: 'credit', amount: '10', reference_id: 'x' });
  assert.strictEqual(str.status, 400);
  const decimals = await addTx(acc.id, { type: 'credit', amount: 1.234, reference_id: 'x' });
  assert.strictEqual(decimals.status, 400);
});

test('rejects debit with insufficient balance and leaves balance unchanged', async () => {
  const acc = await createAccount();
  await addTx(acc.id, { type: 'credit', amount: 20, reference_id: 'r1' });
  const res = await addTx(acc.id, { type: 'debit', amount: 50, reference_id: 'r2' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.error.code, 'INSUFFICIENT_BALANCE');
  const bal = await request(app).get(`/accounts/${acc.id}/balance`);
  assert.strictEqual(bal.body.balance, 20);
});

test('rejects duplicate reference_id for the same account, allows it on another account', async () => {
  const a = await createAccount('A');
  const b = await createAccount('B');
  await addTx(a.id, { type: 'credit', amount: 10, reference_id: 'same' });
  const dup = await addTx(a.id, { type: 'credit', amount: 10, reference_id: 'same' });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.error.code, 'DUPLICATE_TRANSACTION');
  assert.strictEqual(dup.body.error.details.existing_transaction.reference_id, 'same');
  const other = await addTx(b.id, { type: 'credit', amount: 10, reference_id: 'same' });
  assert.strictEqual(other.status, 201);
  const bal = await request(app).get(`/accounts/${a.id}/balance`);
  assert.strictEqual(bal.body.balance, 10); // duplicate did not change balance
});

test('lists transactions latest first with pagination info', async () => {
  const acc = await createAccount();
  for (let i = 1; i <= 5; i++) {
    await addTx(acc.id, { type: 'credit', amount: i, reference_id: `r${i}` });
  }
  const res = await request(app).get(`/accounts/${acc.id}/transactions?page=1&limit=2`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.pagination, { page: 1, limit: 2, total_records: 5, total_pages: 3 });
  assert.deepStrictEqual(res.body.data.map((t) => t.reference_id), ['r5', 'r4']);

  const page3 = await request(app).get(`/accounts/${acc.id}/transactions?page=3&limit=2`);
  assert.deepStrictEqual(page3.body.data.map((t) => t.reference_id), ['r1']);
});

test('filters transactions by type', async () => {
  const acc = await createAccount();
  await addTx(acc.id, { type: 'credit', amount: 100, reference_id: 'c1' });
  await addTx(acc.id, { type: 'debit', amount: 10, reference_id: 'd1' });
  await addTx(acc.id, { type: 'credit', amount: 5, reference_id: 'c2' });

  const credits = await request(app).get(`/accounts/${acc.id}/transactions?type=credit`);
  assert.deepStrictEqual(credits.body.data.map((t) => t.reference_id), ['c2', 'c1']);
  assert.strictEqual(credits.body.pagination.total_records, 2);

  const debits = await request(app).get(`/accounts/${acc.id}/transactions?type=debit`);
  assert.deepStrictEqual(debits.body.data.map((t) => t.reference_id), ['d1']);

  const all = await request(app).get(`/accounts/${acc.id}/transactions`);
  assert.strictEqual(all.body.pagination.total_records, 3);

  const bad = await request(app).get(`/accounts/${acc.id}/transactions?type=refund`);
  assert.strictEqual(bad.status, 400);
});

test('rejects invalid pagination parameters', async () => {
  const acc = await createAccount();
  for (const q of ['page=0', 'limit=abc', 'limit=1000', 'page=-1']) {
    const res = await request(app).get(`/accounts/${acc.id}/transactions?${q}`);
    assert.strictEqual(res.status, 400, q);
    assert.strictEqual(res.body.error.code, 'INVALID_PAGINATION');
  }
});

test('transactions cannot be edited or deleted', async () => {
  const acc = await createAccount();
  const tx = (await addTx(acc.id, { type: 'credit', amount: 10, reference_id: 'r1' })).body.transaction;
  const put = await request(app).put(`/accounts/${acc.id}/transactions/${tx.id}`).send({ amount: 999 });
  assert.strictEqual(put.status, 405);
  const del = await request(app).delete(`/accounts/${acc.id}/transactions/${tx.id}`);
  assert.strictEqual(del.status, 405);

  // Even direct SQL is blocked by database triggers.
  const db = app.locals.db;
  assert.throws(() => db.prepare('UPDATE transactions SET amount = 1').run(), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM transactions').run(), /immutable/);
});

test('transfer: A=100, B=50, transfer 30 -> A=70, B=80', async () => {
  const a = await createAccount('A');
  const b = await createAccount('B');
  await addTx(a.id, { type: 'credit', amount: 100, reference_id: 'seed-a' });
  await addTx(b.id, { type: 'credit', amount: 50, reference_id: 'seed-b' });

  const res = await request(app).post('/transfers').send({
    from_account_id: a.id, to_account_id: b.id, amount: 30, reference_id: 't1',
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.from_account.balance, 70);
  assert.strictEqual(res.body.to_account.balance, 80);
});

test('failed transfer is fully rolled back (no partial transfer)', async () => {
  const a = await createAccount('A');
  const b = await createAccount('B');
  await addTx(a.id, { type: 'credit', amount: 100, reference_id: 'seed' });
  // B already used reference 'dup', so the credit leg fails AFTER the debit leg ran.
  await addTx(b.id, { type: 'credit', amount: 1, reference_id: 'dup' });

  const res = await request(app).post('/transfers').send({
    from_account_id: a.id, to_account_id: b.id, amount: 30, reference_id: 'dup',
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual((await request(app).get(`/accounts/${a.id}`)).body.balance, 100);
  assert.strictEqual((await request(app).get(`/accounts/${b.id}`)).body.balance, 1);
  const hist = await request(app).get(`/accounts/${a.id}/transactions`);
  assert.strictEqual(hist.body.pagination.total_records, 1); // no debit row left behind
});

test('transfer validations', async () => {
  const a = await createAccount('A');
  const b = await createAccount('B');
  const insufficient = await request(app).post('/transfers').send({
    from_account_id: a.id, to_account_id: b.id, amount: 10, reference_id: 't',
  });
  assert.strictEqual(insufficient.status, 422);

  const missing = await request(app).post('/transfers').send({
    from_account_id: a.id, to_account_id: 'nope', amount: 10, reference_id: 't',
  });
  assert.strictEqual(missing.status, 404);

  const same = await request(app).post('/transfers').send({
    from_account_id: a.id, to_account_id: a.id, amount: 10, reference_id: 't',
  });
  assert.strictEqual(same.status, 400);
});

test('amount edge cases: tiny, too many decimals, too large, large valid', async () => {
  const acc = await createAccount();
  for (const amount of [0.00000001, 0.001, 1.005, 1_000_000_000.01]) {
    const res = await addTx(acc.id, { type: 'credit', amount, reference_id: `bad-${amount}` });
    assert.strictEqual(res.status, 400, String(amount));
    assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  }
  const big = await addTx(acc.id, { type: 'credit', amount: 123456789.12, reference_id: 'big' });
  assert.strictEqual(big.status, 201);
  assert.strictEqual(big.body.balance, 123456789.12);
});

test('client mistakes return 4xx, never 500', async () => {
  const acc = await createAccount();
  const huge = await request(app).post('/accounts').set('Content-Type', 'application/json')
    .send(JSON.stringify({ name: 'x'.repeat(200_000) }));
  assert.strictEqual(huge.status, 413);
  assert.strictEqual(huge.body.error.code, 'PAYLOAD_TOO_LARGE');

  const badUrl = await request(app).get('/accounts/%ZZ/balance');
  assert.strictEqual(badUrl.status, 400);
  assert.strictEqual(badUrl.body.error.code, 'INVALID_URL');

  const primitive = await request(app).post('/accounts').set('Content-Type', 'application/json').send('"Alice"');
  assert.strictEqual(primitive.status, 400);
  assert.strictEqual(primitive.body.error.code, 'VALIDATION_ERROR');

  const hugePage = await request(app).get(`/accounts/${acc.id}/transactions?page=99999999999999999999`);
  assert.strictEqual(hugePage.status, 400);
  assert.strictEqual(hugePage.body.error.code, 'INVALID_PAGINATION');

  const readOne = await request(app).get(`/accounts/${acc.id}/transactions/some-id`);
  assert.strictEqual(readOne.status, 404);
});
