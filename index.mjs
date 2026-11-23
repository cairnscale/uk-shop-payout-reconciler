#!/usr/bin/env node
import { parseCsv, parseGbpPence, formatPenceGbp } from '../uk-vat-cis-preflight/index.mjs';

function normaliseOrderRef(ref) {
  return String(ref ?? '').trim().replace(/^#/, '').toUpperCase();
}

export { parseCsv, parseGbpPence, formatPenceGbp };

/**
 * Reconcile ecommerce gateway exports (gross, fee, refund) against Xero/FreeAgent posted rows
 * in BigInt integer pence.
 */
export function reconcileShopPayouts(shopRows, ledgerRows) {
  const shopMap = new Map();
  let shopGross = 0n;
  let shopFees = 0n;
  let shopRefunds = 0n;

  for (const row of shopRows) {
    const ref = normaliseOrderRef(row.order_ref ?? row.order_id ?? row.reference ?? row.name);
    if (!ref) continue;
    const gross = parseGbpPence(row.gross_gbp ?? row.gross ?? row.total);
    const fee = parseGbpPence(row.fee_gbp ?? row.fee ?? 0);
    const refund = parseGbpPence(row.refund_gbp ?? row.refund ?? 0);
    const netExpected = gross - fee - refund;

    shopGross += gross;
    shopFees += fee;
    shopRefunds += refund;

    const prev = shopMap.get(ref) ?? { count: 0, gross: 0n, fee: 0n, refund: 0n, expectedNet: 0n };
    shopMap.set(ref, {
      count: prev.count + 1,
      gross: prev.gross + gross,
      fee: prev.fee + fee,
      refund: prev.refund + refund,
      expectedNet: prev.expectedNet + netExpected,
    });
  }

  const ledgerMap = new Map();
  let ledgerPosted = 0n;
  const duplicateLedgerRefs = [];

  for (const row of ledgerRows) {
    const ref = normaliseOrderRef(row.order_ref ?? row.reference ?? row.invoice_number);
    if (!ref) continue;
    const posted = parseGbpPence(row.posted_gbp ?? row.amount ?? row.total);
    ledgerPosted += posted;
    const prev = ledgerMap.get(ref) ?? { count: 0, posted: 0n };
    if (prev.count >= 1) duplicateLedgerRefs.push(ref);
    ledgerMap.set(ref, { count: prev.count + 1, posted: prev.posted + posted });
  }

  const discrepancies = [];
  let missingInAccounts = 0n;
  let unsplitFees = 0n;
  let accountsOnly = 0n;

  for (const [ref, shop] of shopMap) {
    const acc = ledgerMap.get(ref);
    if (!acc) {
      missingInAccounts += shop.expectedNet;
      discrepancies.push({ order_ref: ref, type: 'missing_in_accounts', delta: formatPenceGbp(-shop.expectedNet) });
      continue;
    }
    if (acc.posted !== shop.expectedNet) {
      if (acc.posted === shop.gross && shop.fee > 0n) {
        unsplitFees += shop.fee;
        discrepancies.push({ order_ref: ref, type: 'gross_posted_without_fee_split', delta: formatPenceGbp(acc.posted - shop.expectedNet) });
      } else {
        discrepancies.push({ order_ref: ref, type: 'amount_mismatch', delta: formatPenceGbp(acc.posted - shop.expectedNet) });
      }
    }
  }

  for (const [ref, acc] of ledgerMap) {
    if (!shopMap.has(ref)) {
      accountsOnly += acc.posted;
      discrepancies.push({ order_ref: ref, type: 'accounts_only_or_duplicate_import', delta: formatPenceGbp(acc.posted) });
    }
  }

  return {
    ordersChecked: shopMap.size,
    ledgerEntriesChecked: ledgerRows.length,
    duplicateLedgerRefs: [...new Set(duplicateLedgerRefs)],
    discrepancies,
    bridge: {
      shopGross: formatPenceGbp(shopGross),
      shopFees: formatPenceGbp(shopFees),
      shopRefunds: formatPenceGbp(shopRefunds),
      expectedNetDeposit: formatPenceGbp(shopGross - shopFees - shopRefunds),
      accountsPosted: formatPenceGbp(ledgerPosted),
      missingInAccounts: formatPenceGbp(missingInAccounts),
      unsplitGatewayFees: formatPenceGbp(unsplitFees),
      accountsOnly: formatPenceGbp(accountsOnly),
      unexplainedVariance: formatPenceGbp(ledgerPosted - (shopGross - shopFees - shopRefunds)),
    },
  };
}
