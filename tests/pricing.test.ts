import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceUsage } from '../server/pricing.ts';

test('prices separate cached input, apply speed multipliers without a long-context uplift, and retain unknown prices', () => {
  const usage = { input: 1000, cached: 800, write: 0, output: 100 };
  const price = priceUsage('gpt-6.1-sol', 'default', usage)!;
  assert.ok(Math.abs(price.inputCost - 0.0004) < 1e-10);
  assert.ok(Math.abs(price.cachedCost - 0.00008) < 1e-10);
  assert.ok(Math.abs(price.outputCost - 0.001) < 1e-10);
  assert.ok(Math.abs(price.savings - 0.00152) < 1e-10);
  assert.equal(priceUsage('gpt-6.1-sol', 'priority', usage)!.outputCost, 0.002);
  const large = priceUsage('gpt-6.1-sol', null, {
    input: 500_000,
    cached: 400_000,
    write: 0,
    output: 10_000,
  })!;
  assert.ok(Math.abs(large.inputCost - 0.2) < 1e-10);
  assert.ok(Math.abs(large.cachedCost - 0.04) < 1e-10);
  assert.ok(Math.abs(large.outputCost - 0.1) < 1e-10);
  assert.ok(Math.abs(large.savings - 0.76) < 1e-10);
  assert.equal(priceUsage('unknown', null, usage), null);
  assert.equal(priceUsage('gpt-6.1-sol', 'mystery-tier', usage), null);
  assert.equal(priceUsage('gpt-6.1-sol', null, { ...usage, write: 100 }), null);
});
