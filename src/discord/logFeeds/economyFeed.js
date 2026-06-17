'use strict';

const { sendToChannel } = require('../notifications');
const { buildEconomyEmbed } = require('./embeds');

const TIMESTAMP_RE = /^([\d.-]+):\s+(.+)$/;

const TRADE_RE = /^\[Trade\]\s+Tradeable\s+\((.+?)\)\s+(sold by|purchased by)\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+.*?(to|from)\s+trader\s+([^,]+)/;
const MECHANIC_RE = /^\[Trade-Mechanic\]\s+Service\s+\((.+?)\)\s+purchased by\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+money\s+from\s+trader\s+([^,]+)/;
const BANK_DEPOSIT_RE = /^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?deposited\s+(\d+)\((\d+)\s+was\s+added\)/;
const BANK_WITHDRAW_RE = /^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?withdrew\s+(\d+)\((\d+)\s+was\s+removed\)/;
const BANK_CARD_RE = /^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?purchased\s+(.+?)\s+card.*?new\s+account\s+balance\s+is\s+(\d+)\s+credits/;
const CURRENCY_BUY_GOLD_RE = /^\[Currency Conversion\]\s+(.+?)\(ID:(\d+)\)\(Account Number:\d+\).*?purchased\s+(\d+)\s+gold\s+for\s+(\d+)\s+credits.*?new\s+account\s+balance\s+is\s+(\d+)\s+gold\/(\d+)\s+credits/;
const CURRENCY_SELL_GOLD_RE = /^\[Currency Conversion\]\s+(.+?)\(ID:(\d+)\)\(Account Number:\d+\).*?sold\s+(\d+)\s+gold\s+for\s+(\d+)\s+credits.*?new\s+account\s+balance\s+is\s+(\d+)\s+gold\/(\d+)\s+credits/;
const BANK_CARD_DESTROY_RE = /^\[Bank\]\s+(.+?)\(ID:(\d+)\).*?manually\s+destroyed\s+(.+?)\s+card/;
const SQUAD_PENALTY_RE = /^\[SquadPenalties\]\s+Squad\s+leaving\s+penalty\s+carried\s+out\s+for\s+(.+?)\((\d+)\)\s+for\s+(\d+)\s+money/;

/**
 * Parse one economy log line. Mirrors ConvertFrom-EconomyLine from economy-log.psm1.
 * Financial-state ("Before"/"After") lines (Pattern 9) are intentionally skipped.
 */
function parseLine(line) {
  const tm = TIMESTAMP_RE.exec(line);
  if (!tm) return null;
  const content = tm[2].trim();

  let m;
  if ((m = TRADE_RE.exec(content))) {
    const item = m[1];
    const isSell = m[2] === 'sold by';
    const playerName = m[3];
    const steamId = m[4];
    const amount = parseInt(m[5], 10);
    const trader = (m[7] || 'Unknown').trim();
    return {
      type: isSell ? 'sell' : 'buy',
      playerName,
      steamId,
      item,
      amount,
      trader,
    };
  }

  if ((m = MECHANIC_RE.exec(content))) {
    return {
      type: 'mechanic',
      playerName: m[2],
      steamId: m[3],
      item: m[1],
      amount: parseInt(m[4], 10),
      trader: (m[5] || 'Unknown').trim(),
    };
  }

  if ((m = BANK_DEPOSIT_RE.exec(content))) {
    return {
      type: 'bank_deposit',
      playerName: m[1],
      steamId: m[2],
      amount: parseInt(m[3], 10),
      netAmount: parseInt(m[4], 10),
    };
  }

  if ((m = BANK_WITHDRAW_RE.exec(content))) {
    return {
      type: 'bank_withdraw',
      playerName: m[1],
      steamId: m[2],
      amount: parseInt(m[3], 10),
      netAmount: parseInt(m[4], 10),
    };
  }

  if ((m = BANK_CARD_RE.exec(content))) {
    return {
      type: 'bank_card',
      playerName: m[1],
      steamId: m[2],
      cardType: m[3],
      amount: parseInt(m[4], 10),
    };
  }

  if ((m = CURRENCY_BUY_GOLD_RE.exec(content))) {
    const goldAmount = parseInt(m[3], 10);
    const creditsAmount = parseInt(m[4], 10);
    const newGoldBalance = parseInt(m[5], 10);
    const newCreditBalance = parseInt(m[6], 10);
    return {
      type: 'currency_conversion',
      playerName: m[1],
      steamId: m[2],
      amount: creditsAmount,
      beforeGold: newGoldBalance - goldAmount,
      afterGold: newGoldBalance,
      beforeAccount: newCreditBalance + creditsAmount,
      afterAccount: newCreditBalance,
    };
  }

  if ((m = CURRENCY_SELL_GOLD_RE.exec(content))) {
    const goldAmount = parseInt(m[3], 10);
    const creditsAmount = parseInt(m[4], 10);
    const newGoldBalance = parseInt(m[5], 10);
    const newCreditBalance = parseInt(m[6], 10);
    return {
      type: 'gold_sale',
      playerName: m[1],
      steamId: m[2],
      amount: creditsAmount,
      beforeGold: newGoldBalance + goldAmount,
      afterGold: newGoldBalance,
      beforeAccount: newCreditBalance - creditsAmount,
      afterAccount: newCreditBalance,
    };
  }

  if ((m = BANK_CARD_DESTROY_RE.exec(content))) {
    return {
      type: 'bank_card_destroy',
      playerName: m[1],
      steamId: m[2],
      cardType: m[3],
    };
  }

  if ((m = SQUAD_PENALTY_RE.exec(content))) {
    return {
      type: 'squad_penalty',
      playerName: m[1],
      steamId: m[2],
      amount: parseInt(m[3], 10),
    };
  }

  return null;
}

async function handle(event, client, config) {
  const feedCfg = config.SCUMLogFeatures.EconomyFeed;
  if (!feedCfg.Enabled || !feedCfg.Channel) return;

  const embed = buildEconomyEmbed(event);
  await sendToChannel(client, feedCfg.Channel, [], embed);
}

module.exports = {
  name: 'economy',
  logPrefix: 'economy_',
  isEnabled: (config) => !!(config.SCUMLogFeatures.EconomyFeed && config.SCUMLogFeatures.EconomyFeed.Enabled),
  parseLine,
  handle,
};
