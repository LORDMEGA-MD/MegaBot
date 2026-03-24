const processedMessages = new Set();
const { isJidGroup } = require('@whiskeysockets/baileys');
const {
  getAntibot,
  setAntibot,
  removeAntibot,
  incrementWarningCount,
  resetWarningCount,
  isSudo,
} = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const config = require('../config');

const WARN_COUNT = config.WARN_COUNT || 3;

// ─── Bot command prefixes ─────────────────────────────────────────────────────
const BOT_PREFIXES = [
  '!', '.', '/', '#', '$', '%', '^', '&', '*', '-', '+', '?', '~', '|', ':'
];

// ─── Known bot signature phrases ──────────────────────────────────────────────
const BOT_SIGNATURES = [
  'powered by', 'bot by', 'made by', '• prefix', '• version',
  'multi device', 'whatsapp bot', 'wa bot', 'auto reply',
  'automated message', 'this is an automated', '```',
  '> *', '╔═', '║', '╚═', '┌─', '└─', '━━━',
  '▢', '◉', '❏', '➣', '◈',
];

// ─── Known bot JID patterns ───────────────────────────────────────────────────
const BOT_NUMBER_PATTERNS = [
  /^0@/,
  /^1234/,
];

// ─── Structural message patterns ──────────────────────────────────────────────
const STRUCTURED_PATTERNS = [
  /^\*\[.+\]\*$/m,
  /^_{10,}/m,
  /^-{10,}/m,
  /^={10,}/m,
  /^\*[A-Z\s]{5,}\*$/m,
  /\*\d+\.\s/,
  /\[\s*(on|off|yes|no)\s*\]/i,
  /uptime\s*:/i,
  /ping\s*:/i,
  /ram\s*:/i,
  /speed\s*:/i,
  /prefix\s*:/i,
  /version\s*:/i,
  /owner\s*:/i,
];

// ─── Per-JID rate tracking ────────────────────────────────────────────────────
// Tracks message timestamps to detect flooding
// Map<senderJid, number[]> — stores last N message timestamps per sender per group
const messageRateTracker = new Map();

// ─── Per-JID typing event tracker ────────────────────────────────────────────
// Tracks whether a sender had a typing event before sending
// Map<`${groupJid}:${senderJid}`, { typingAt: number, lastMsgAt: number }>
const typingTracker = new Map();

// ─── Per-JID edit speed tracker ──────────────────────────────────────────────
// Tracks message send time so we can detect near-instant edits
// Map<msgId, { sentAt: number, senderJid: string }>
const editTracker = new Map();

const RATE_WINDOW_MS = 5000;      // 5 second window for rate check
const RATE_MSG_THRESHOLD = 4;     // 4+ messages in 5s = bot
const TYPING_GRACE_MS = 8000;     // typing event must be within 8s before message
const FAST_EDIT_THRESHOLD_MS = 1500; // edit within 1.5s of send = bot
const LONG_MSG_THRESHOLD = 300;   // chars — long message threshold for quoted check

/**
 * Called from your messages.upsert handler for ALL messages (not just groups).
 * Records typing presence updates so we can cross-reference with messages.
 * You must also hook sock.ev.on('presence.update') and call this.
 */
function handlePresenceUpdate(update) {
  try {
    const { id: groupJid, presences } = update;
    if (!presences) return;

    for (const [jid, presence] of Object.entries(presences)) {
      if (presence.lastKnownPresence === 'composing') {
        const key = `${groupJid}:${jid}`;
        const existing = typingTracker.get(key) || {};
        typingTracker.set(key, { ...existing, typingAt: Date.now() });
        // Clean up after 30s
        setTimeout(() => typingTracker.delete(key), 30_000);
      }
    }
  } catch (e) {
    console.error('[ANTIBOT PRESENCE ERROR]', e);
  }
}

/**
 * Returns true if the sender had a recent typing event before this message.
 * If no typing event recorded, it's suspicious (bot behaviour).
 */
function hadTypingEvent(groupJid, senderJid) {
  const key = `${groupJid}:${senderJid}`;
  const record = typingTracker.get(key);
  if (!record?.typingAt) return false;
  return (Date.now() - record.typingAt) <= TYPING_GRACE_MS;
}

/**
 * Tracks message send rate per sender.
 * Returns true if sender has exceeded the rate threshold.
 */
function isRateSurge(groupJid, senderJid) {
  const key = `${groupJid}:${senderJid}`;
  const now = Date.now();
  const timestamps = messageRateTracker.get(key) || [];

  // Keep only timestamps within the window
  const recent = timestamps.filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  messageRateTracker.set(key, recent);

  // Clean up after window expires
  setTimeout(() => {
    const current = messageRateTracker.get(key) || [];
    const cleaned = current.filter(t => Date.now() - t < RATE_WINDOW_MS);
    if (cleaned.length === 0) {
      messageRateTracker.delete(key);
    } else {
      messageRateTracker.set(key, cleaned);
    }
  }, RATE_WINDOW_MS + 500);

  return recent.length >= RATE_MSG_THRESHOLD;
}

/**
 * Registers a message send time for edit speed tracking.
 * Call this for every message, not just suspected bots.
 */
function trackMessageForEdit(msgId, senderJid) {
  editTracker.set(msgId, { sentAt: Date.now(), senderJid });
  // Clean up after 60s
  setTimeout(() => editTracker.delete(msgId), 60_000);
}

/**
 * Returns true if a message was edited suspiciously fast after being sent.
 * Bots that "auto-correct" or update messages do this nearly instantly.
 */
function isFastEdit(editedMsgId) {
  const record = editTracker.get(editedMsgId);
  if (!record) return false;
  return (Date.now() - record.sentAt) <= FAST_EDIT_THRESHOLD_MS;
}

/**
 * Returns true if message is long, quotes another message,
 * AND the sender had no typing event — classic bot reply pattern.
 */
function isLongQuotedNoTyping(msg, groupJid, senderJid) {
  const m = msg?.message;
  if (!m) return false;

  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption || '';

  if (text.length < LONG_MSG_THRESHOLD) return false;

  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo;

  // Must have a quoted message
  if (!ctx?.quotedMessage) return false;

  // Must have no typing event
  if (hadTypingEvent(groupJid, senderJid)) return false;

  return true;
}

/**
 * Core scoring engine — checks all static content-based signals.
 */
function getContentScore(msg) {
  const m = msg?.message;
  if (!m) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title || '';

  const lowerText = text.toLowerCase();

  if (text && BOT_PREFIXES.some(p => text.trimStart().startsWith(p))) {
    score += 3;
    reasons.push('starts with bot command prefix');
  }

  const foundSig = BOT_SIGNATURES.find(sig => lowerText.includes(sig.toLowerCase()));
  if (foundSig) {
    score += 4;
    reasons.push(`contains bot signature: "${foundSig}"`);
  }

  const foundPattern = STRUCTURED_PATTERNS.find(p => p.test(text));
  if (foundPattern) {
    score += 3;
    reasons.push('matches structural bot pattern');
  }

  if (
    m.buttonsMessage || m.listMessage || m.templateMessage ||
    m.interactiveMessage || m.buttonsResponseMessage || m.listResponseMessage
  ) {
    score += 5;
    reasons.push('uses interactive/buttons/list message type');
  }

  if (m.viewOnceMessage || m.viewOnceMessageV2) {
    score += 1;
    reasons.push('sent view-once message');
  }

  const boldCount = (text.match(/\*/g) || []).length;
  const monoCount = (text.match(/`/g) || []).length;
  const emojiLineCount = (text.match(/^[\p{Emoji}]/gmu) || []).length;

  if (boldCount >= 6) { score += 2; reasons.push(`excessive bold (${boldCount})`); }
  if (monoCount >= 4) { score += 2; reasons.push(`excessive monospace (${monoCount})`); }
  if (emojiLineCount >= 4) { score += 1; reasons.push(`many emoji lines (${emojiLineCount})`); }

  if (text.length > 500 && boldCount >= 4) {
    score += 2;
    reasons.push('long structured message');
  }

  const senderJid = msg.key?.participant || msg.key?.remoteJid || '';
  if (BOT_NUMBER_PATTERNS.some(p => p.test(senderJid))) {
    score += 3;
    reasons.push('sender JID matches bot number pattern');
  }

  const quotedText =
    m.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
    m.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '';
  if (quotedText && BOT_PREFIXES.some(p => quotedText.trimStart().startsWith(p))) {
    score += 3;
    reasons.push('replying to a bot command');
  }

  if (m.protocolMessage || m.senderKeyDistributionMessage) {
    score += 2;
    reasons.push('protocol/key distribution message');
  }

  if (/https?:\/\/[^\s]+\?[^\s]+/.test(text)) {
    score += 1;
    reasons.push('URL with query parameters');
  }

  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length >= 8 && text.length / lines.length < 20) {
    score += 2;
    reasons.push(`high newline density (${lines.length} lines)`);
  }

  return { score, reasons };
}

/**
 * Full bot score including all behavioural signals.
 * Score of 5+ = likely bot.
 */
function getBotScore(msg, groupJid, senderJid, isEdit = false, editedMsgId = null) {
  const { score: contentScore, reasons } = getContentScore(msg);
  let score = contentScore;

  // ── Behavioural Signal 1: Message rate surge ──────────────────────────
  if (isRateSurge(groupJid, senderJid)) {
    score += 5;
    reasons.push(`rate surge: ${RATE_MSG_THRESHOLD}+ messages in ${RATE_WINDOW_MS / 1000}s`);
  }

  // ── Behavioural Signal 2: No typing event before message ──────────────
  // Only flag this if there's other suspicious content too (score >= 2)
  // to avoid false positives on people who just type fast
  if (contentScore >= 2 && !hadTypingEvent(groupJid, senderJid)) {
    score += 2;
    reasons.push('no typing event detected before message');
  }

  // ── Behavioural Signal 3: Fast edit ───────────────────────────────────
  if (isEdit && editedMsgId && isFastEdit(editedMsgId)) {
    score += 4;
    reasons.push(`message edited within ${FAST_EDIT_THRESHOLD_MS}ms of sending`);
  }

  // ── Behavioural Signal 4: Long quoted message with no typing ─────────
  if (isLongQuotedNoTyping(msg, groupJid, senderJid)) {
    score += 4;
    reasons.push('long quoted reply with no typing event (automated response)');
  }

  return { score, reasons };
}

function isLikelyBot(msg, groupJid, senderJid, isEdit = false, editedMsgId = null) {
  const { score } = getBotScore(msg, groupJid, senderJid, isEdit, editedMsgId);
  return score >= 5;
}

async function AntiBot(msg, sock, { isEdit = false, editedMsgId = null } = {}) {
  try {
    if (!msg?.key?.remoteJid) return;

    const jid = msg.key.remoteJid;
    if (!isJidGroup(jid)) return;
    if (msg.key.fromMe) return;

    const sender = msg.key.participant || msg.participant;
    if (!sender) return;

    // Always track message for edit detection regardless of bot check
    if (msg.key.id) trackMessageForEdit(msg.key.id, sender);

    if (!isLikelyBot(msg, jid, sender, isEdit, editedMsgId)) return;

    const msgId = msg.key.id;
    if (!msgId || processedMessages.has(msgId)) return;
    processedMessages.add(msgId);
    setTimeout(() => processedMessages.delete(msgId), 60_000);

    if (await isSudo(sender)) return;

    const adminCheck = await isAdmin(sock, jid, sender);
    const isSenderAdmin =
      typeof adminCheck === 'boolean' ? adminCheck : adminCheck?.isSenderAdmin;
    if (isSenderAdmin) return;

    // Whitelist own bot number
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    if (sender === botJid) return;

    const botAdminCheck = await isAdmin(sock, jid, sock.user.id);
    const isBotAdmin =
      typeof botAdminCheck === 'boolean' ? botAdminCheck : botAdminCheck?.isBotAdmin;
    if (!isBotAdmin) return;

    const configData = await getAntibot(jid, 'on');
    if (!configData?.enabled) return;

    const action = configData.action || 'delete';

    const { score, reasons } = getBotScore(msg, jid, sender, isEdit, editedMsgId);
    console.log(`[ANTIBOT] Bot detected in ${jid} | sender: ${sender} | score: ${score} | reasons: ${reasons.join(', ')} | action: ${action}`);

    await sock.sendMessage(jid, { delete: msg.key });

    const tag = `@${sender.split('@')[0]}`;

    if (action === 'delete') return;

    if (action === 'kick') {
      await sock.groupParticipantsUpdate(jid, [sender], 'remove');
      return;
    }

    if (action === 'warn') {
      const count = await incrementWarningCount(jid, sender);
      if (count >= WARN_COUNT) {
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        await resetWarningCount(jid, sender);
        await sock.sendMessage(jid, {
          text: `${tag} has been removed — bots are not allowed in this group`,
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(jid, {
          text: `${tag} warning ${count}/${WARN_COUNT} — bots are not allowed in this group`,
          mentions: [sender],
        });
      }
    }
  } catch (e) {
    console.error('[ANTIBOT ERROR]', e);
  }
}

async function handleAntiBotCommand(jid, sender, args, sock) {
  if (!isJidGroup(jid)) return 'Group only command';

  const adminCheck = await isAdmin(sock, jid, sender);
  const isSenderAdmin =
    typeof adminCheck === 'boolean' ? adminCheck : adminCheck?.isSenderAdmin;
  if (!isSenderAdmin) return 'Admins only';

  const [mode, action] = args.split(' ');

  if (mode === 'on') {
    if (!['warn', 'kick', 'delete'].includes(action))
      return 'Usage: .antibot on [warn|kick|delete]';

    await setAntibot(jid, 'on', action);

    const descriptions = {
      delete: '✅ Antibot enabled — bot messages will be silently deleted',
      kick: '✅ Antibot enabled — bot messages will be deleted and the bot kicked',
      warn: `✅ Antibot enabled — bot messages will be deleted and warned (kicked after ${WARN_COUNT} warns)`,
    };

    return descriptions[action];
  }

  if (mode === 'off') {
    await removeAntibot(jid);
    return '✅ Antibot disabled';
  }

  return 'Usage: .antibot on|off [warn|kick|delete]';
}

module.exports = {
  AntiBot,
  handleAntiBotCommand,
  handlePresenceUpdate,
  isLikelyBot,
  getBotScore,
};
