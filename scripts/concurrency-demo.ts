const BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const CONCURRENT_REQUESTS = 10;
const ITEM_QUANTITY = 5;

async function main() {
  const createRes = await fetch(`${BASE_URL}/v1/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Concurrency Demo Item', initial_quantity: ITEM_QUANTITY }),
  });
  const item = await createRes.json();
  console.log(`Created item ${item.id} with quantity ${ITEM_QUANTITY}`);

  const attempts = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    fetch(`${BASE_URL}/v1/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, customer_id: `customer-${i}`, quantity: 1 }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }))
  );

  const results = await Promise.all(attempts);
  const succeeded = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 409).length;

  console.log(`Fired ${CONCURRENT_REQUESTS} concurrent reservation requests for 1 unit each.`);
  console.log(`Succeeded: ${succeeded}, Rejected (409 insufficient availability): ${rejected}`);

  const statusRes = await fetch(`${BASE_URL}/v1/items/${item.id}`);
  console.log('Final item status:', await statusRes.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
