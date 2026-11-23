import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileShopPayouts } from './index.mjs';

test('isolates unsplit gateway fees, missing orders, and duplicates in BigInt pence', () => {
  const shop = [
    { order_ref: '#CS-101', gross_gbp: '100.00', fee_gbp: '2.90', refund_gbp: '0.00' },
    { order_ref: '#CS-102', gross_gbp: '200.00', fee_gbp: '4.10', refund_gbp: '0.00' },
    { order_ref: '#CS-103', gross_gbp: '50.00', fee_gbp: '1.50', refund_gbp: '0.00' },
  ];
  const xero = [
    { reference: 'CS-101', posted_gbp: '100.00' },
    { reference: 'CS-102', posted_gbp: '195.90' },
  ];
  const rep = reconcileShopPayouts(shop, xero);
  assert.equal(rep.bridge.expectedNetDeposit, '£341.50');
  assert.equal(rep.bridge.unsplitGatewayFees, '£2.90');
  assert.equal(rep.bridge.missingInAccounts, '£48.50');
  assert.equal(rep.discrepancies.length, 2);
});
