const { isJidGroup } = require('@whiskeysockets/baileys');
const { getAntilink, incrementWarningCount, resetWarningCount, isSudo } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const config = require('../config');

const WARN_COUNT = config.WARN_COUNT || 3;

// ─── URL / invite link patterns ───────────────────────────────────────────────
const LINK_PATTERNS = [
  /chat\.whatsapp\.com\/[A-Za-z0-9]{10,}/i,       // WhatsApp group invite
  /wa\.me\/[A-Za-z0-9+?=&]+/i,                    // wa.me links
  /whatsapp\.com\/channel\/[A-Za-z0-9_-]+/i,       // WhatsApp channel links
  /t\.me\/[A-Za-z0-9_+]+/i,                        // Telegram links
  /https?:\/\/[^\s]+/i,                            // Any http/https URL
  /www\.[a-z0-9-]+\.[a-z]{2,}/i,                  // www. links
  /[a-z0-9-]+\.(com|net|org|io|gg|xyz|me|ly|co|app|dev|link|site|online|shop|info|biz)(\/\S*)?/i, // bare domains
];

/**
 * Checks if a string contains any link.
 */
function containsLink(str) {
  if (!str || typeof str !== 'string') return false;
  return LINK_PATTERNS.some(p => p.test(str));
}

/**
 * Extracts all text content from a message including
 * forwarded channel content, captions, buttons, and template messages.
 */
function extractAllText(msg) {
  const m = msg?.message;
  if (!m) return '';

  const parts = [];

  // ── Standard text ────────────────────────────────────────────────────
  if (m.conversation) parts.push(m.conversation);
  if (m.extendedTextMessage?.text) parts.push(m.extendedTextMessage.text);

  // ── Media captions ───────────────────────────────────────────────────
  if (m.imageMessage?.caption) parts.push(m.imageMessage.caption);
  if (m.videoMessage?.caption) parts.push(m.videoMessage.caption);
  if (m.documentMessage?.caption) parts.push(m.documentMessage.caption);
  if (m.audioMessage?.caption) parts.push(m.audioMessage.caption);

  // ── Forwarded channel / newsletter messages ──────────────────────────
  // These arrive as a wrapped message inside forwardedNewsletterMessageInfo
  const fwdCtx =
    m.extendedTextMessage?.contextInfo?.forwardedNewsletterMessageInfo ||
    m.imageMessage?.contextInfo?.forwardedNewsletterMessageInfo ||
    m.videoMessage?.contextInfo?.forwardedNewsletterMessageInfo;

  if (fwdCtx?.newsletterJid) {
    // The message itself is a channel forward — flag it regardless of text
    parts.push('channel_forward_detected');
  }

  // ── Button messages (joinGroupLink / regular buttons) ─────────────────
  if (m.buttonsMessage) {
    if (m.buttonsMessage.contentText) parts.push(m.buttonsMessage.contentText);
    if (m.buttonsMessage.footerText) parts.push(m.buttonsMessage.footerText);
    if (m.buttonsMessage.headerType === 1 && m.buttonsMessage.imageMessage?.caption) {
      parts.push(m.buttonsMessage.imageMessage.caption);
    }
    // Check each button for URLs or invite links
    for (const btn of m.buttonsMessage.buttons || []) {
      if (btn.buttonText?.displayText) parts.push(btn.buttonText.displayText);
      if (btn.nativeFlowInfo?.paramsJson) parts.push(btn.nativeFlowInfo.paramsJson);
    }
  }

  // ── Template messages (often used for channel promotions) ─────────────
  if (m.templateMessage) {
    const hydratedTpl = m.templateMessage.hydratedTemplate || m.templateMessage.hydratedFourRowTemplate;
    if (hydratedTpl) {
      if (hydratedTpl.hydratedContentText) parts.push(hydratedTpl.hydratedContentText);
      if (hydratedTpl.hydratedFooterText) parts.push(hydratedTpl.hydratedFooterText);
      for (const btn of hydratedTpl.hydratedButtons || []) {
        if (btn.urlButton?.displayText) parts.push(btn.urlButton.displayText);
        if (btn.urlButton?.url) parts.push(btn.urlButton.url);
        if (btn.callButton?.displayText) parts.push(btn.callButton.displayText);
        // Join group buttons contain invite links
        if (btn.quickReplyButton?.payload) parts.push(btn.quickReplyButton.payload);
      }
    }
  }

  // ── Interactive messages (newer WhatsApp UI) ──────────────────────────
  if (m.interactiveMessage) {
    if (m.interactiveMessage.body?.text) parts.push(m.interactiveMessage.body.text);
    if (m.interactiveMessage.footer?.text) parts.push(m.interactiveMessage.footer.text);
    const nativeFlow = m.interactiveMessage.nativeFlowMessage;
    if (nativeFlow?.buttons) {
      for (const btn of nativeFlow.buttons) {
        if (btn.name) parts.push(btn.name);
        if (btn.buttonParamsJson) parts.push(btn.buttonParamsJson);
      }
    }
  }

  // ── List messages ─────────────────────────────────────────────────────
  if (m.listMessage) {
    if (m.listMessage.description) parts.push(m.listMessage.description);
    for (const section of m.listMessage.sections || []) {
      for (const row of section.rows || []) {
        if (row.description) parts.push(row.description);
      }
    }
  }

  // ── Forwarded messages (isForwarded flag) ─────────────────────────────
  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo;

  if (ctx?.isForwarded && ctx?.forwardingScore >= 1) {
    // Forwarded messages from outside the group are suspicious
    // Check if the quoted/forwarded content has links
    const quotedText =
      ctx.quotedMessage?.conversation ||
      ctx.quotedMessage?.extendedTextMessage?.text ||
      ctx.quotedMessage?.imageMessage?.caption ||
      ctx.quotedMessage?.videoMessage?.caption || '';
    if (quotedText) parts.push(quotedText);
  }

  return parts.join(' ');
}

/**
 * Returns true if the message is a channel forward
 * (forwardedNewsletterMessageInfo present).
 */
function isChannelForward(msg) {
  const m = msg?.message;
  if (!m) return false;

  const ctxTypes = [
    m.extendedTextMessage?.contextInfo,
    m.imageMessage?.contextInfo,
    m.videoMessage?.contextInfo,
    m.documentMessage?.contextInfo,
    m.audioMessage?.contextInfo,
    m.stickerMessage?.contextInfo,
  ];

  return ctxTypes.some(ctx => ctx?.forwardedNewsletterMessageInfo?.newsletterJid);
}

/**
 * Returns true if the message contains a join group button or invite button.
 */
function hasJoinGroupButton(msg) {
  const m = msg?.message;
  if (!m) return false;

  // Template message with URL buttons pointing to WhatsApp invite
  const hydratedTpl =
    m.templateMessage?.hydratedTemplate ||
    m.templateMessage?.hydratedFourRowTemplate;

  if (hydratedTpl) {
    for (const btn of hydratedTpl.hydratedButtons || []) {
      const url = btn.urlButton?.url || '';
      if (/chat\.whatsapp\.com/i.test(url)) return true;
      if (/wa\.me\//i.test(url)) return true;
    }
  }

  // Interactive message buttons
  const nativeFlow = m.interactiveMessage?.nativeFlowMessage;
  if (nativeFlow?.buttons) {
    for (const btn of nativeFlow.buttons) {
      const params = btn.buttonParamsJson || '';
      if (/chat\.whatsapp\.com/i.test(params)) return true;
      if (/wa\.me\//i.test(params)) return true;
    }
  }

  // buttonsMessage with invite links
  for (const btn of m.buttonsMessage?.buttons || []) {
    const params = btn.nativeFlowInfo?.paramsJson || '';
    if (/chat\.whatsapp\.com/i.test(params)) return true;
    if (/wa\.me\//i.test(params)) return true;
  }

  return false;
}

async function Antilink(msg, sock) {
  const jid = msg.key.remoteJid;
  if (!isJidGroup(jid)) return;

  const sender = msg.key.participant;
  if (!sender) return;

  // Skip admins and sudo
  try {
    const { isSenderAdmin } = await isAdmin(sock, jid, sender);
    if (isSenderAdmin) return;
  } catch (_) {}
  if (await isSudo(sender)) return;

  // Check bot admin silently
  try {
    const { isBotAdmin } = await isAdmin(sock, jid, sock.user.id);
    if (!isBotAdmin) return;
  } catch (_) { return; }

  const antilinkConfig = await getAntilink(jid, 'on');
  if (!antilinkConfig?.enabled && !antilinkConfig) return;

  // ── Determine if this message should be actioned ──────────────────────
  const allText = extractAllText(msg);
  const hasLink = containsLink(allText);
  const channelFwd = isChannelForward(msg);
  const joinBtn = hasJoinGroupButton(msg);

  // Trigger if: contains a link OR is a channel forward OR has a join button
  if (!hasLink && !channelFwd && !joinBtn) return;

  const action = antilinkConfig.action || 'delete';

  try {
    // Always delete the message
    await sock.sendMessage(jid, { delete: msg.key });

    const tag = `@${sender.split('@')[0]}`;

    switch (action) {
      case 'delete':
        await sock.sendMessage(jid, {
          text: `\`\`\`${tag} links and channel forwardings are not allowed here\`\`\``,
          mentions: [sender],
        });
        break;

      case 'kick':
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        break;

      case 'warn':
        const count = await incrementWarningCount(jid, sender);
        if (count >= WARN_COUNT) {
          await sock.groupParticipantsUpdate(jid, [sender], 'remove');
          await resetWarningCount(jid, sender);
          await sock.sendMessage(jid, {
            text: `\`\`\`${tag} has been removed after ${WARN_COUNT} warnings for sending links\`\`\``,
            mentions: [sender],
          });
        } else {
          await sock.sendMessage(jid, {
            text: `\`\`\`${tag} warning ${count}/${WARN_COUNT} — links are not allowed here\`\`\``,
            mentions: [sender],
          });
        }
        break;
    }
  } catch (error) {
    console.error('[ANTILINK ERROR]', error);
  }
}

module.exports = { Antilink };
