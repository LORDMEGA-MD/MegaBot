const processedMessages = new Set();
const { isJidGroup } = require('@whiskeysockets/baileys');
const {
  getAntigroupmention,
  setAntigroupmention,
  removeAntigroupmention,
  incrementWarningCount,
  resetWarningCount,
  isSudo
} = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const config = require('../config');

const WARN_COUNT = config.WARN_COUNT || 3;

function isGroupStatusMention(msg) {
  const m = msg?.message;
  if (!m) return false;

  const msgStr = JSON.stringify(m).toLowerCase();

  if (m.statusMentionMessage) return true;

  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    m.reactionMessage?.contextInfo ||
    m.buttonsMessage?.contextInfo ||
    m.listMessage?.contextInfo;

  if (ctx?.statusJidList?.length > 0) return true;

  const viewOnceMsg =
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.viewOnceMessageV2Extension?.message;

  if (viewOnceMsg) {
    const voCtx =
      viewOnceMsg.imageMessage?.contextInfo ||
      viewOnceMsg.videoMessage?.contextInfo ||
      viewOnceMsg.extendedTextMessage?.contextInfo;

    if (voCtx?.statusJidList?.length > 0) return true;
    if (voCtx?.statusMentionMessage) return true;
    if (viewOnceMsg.statusMentionMessage) return true;
  }

  const extCtx = m.extendedTextMessage?.contextInfo;
  if (extCtx?.remoteJid === 'status@broadcast') return true;

  if (
    ctx?.forwardedNewsletterMessageInfo?.newsletterJid ||
    extCtx?.forwardedNewsletterMessageInfo?.newsletterJid
  ) return true;

  if (
    msgStr.includes('statusjidlist') ||
    msgStr.includes('statusmentionmessage') ||
    msgStr.includes('status@broadcast')
  ) return true;

  return false;
}

function isForwardedOrRepliedStatusMention(msg) {
  const m = msg?.message;
  if (!m) return false;

  const ctx =
    m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo;

  if (ctx?.stanzaId && ctx?.participant) return true;
  if (ctx?.isForwarded && ctx?.forwardingScore > 0) return true;

  return false;
}

async function AntiGroupMention(msg, sock) {
  try {
    if (!msg?.key?.remoteJid) return;

    let jid = msg.key.remoteJid;
    if (!isJidGroup(jid)) {
      jid =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key
          ?.remoteJid || jid;
    }
    if (!isJidGroup(jid)) return;

    if (!isGroupStatusMention(msg)) return;
    if (isForwardedOrRepliedStatusMention(msg)) return;

    const msgId = msg.key.id;
    if (!msgId || processedMessages.has(msgId)) return;
    processedMessages.add(msgId);
    setTimeout(() => processedMessages.delete(msgId), 60_000);

    const sender = msg.key.participant || msg.participant;
    if (!sender) return;

    if (await isSudo(sender)) return;

    const adminCheck = await isAdmin(sock, jid, sender);
    const isSenderAdmin =
      typeof adminCheck === 'boolean'
        ? adminCheck
        : adminCheck?.isSenderAdmin;

    if (isSenderAdmin) return;

    const botAdminCheck = await isAdmin(sock, jid, sock.user.id);
    const isBotAdmin =
      typeof botAdminCheck === 'boolean'
        ? botAdminCheck
        : botAdminCheck?.isBotAdmin;

    if (!isBotAdmin) return;

    const configData = await getAntigroupmention(jid, 'on');
    if (!configData?.enabled) return;

    const action = configData.action || 'delete';

    console.log(`[ANTIGROUPMENTION] GROUP_STATUS_MENTION in ${jid} from ${sender}. Action: ${action}`);

    // Always delete the message first
    await sock.sendMessage(jid, { delete: msg.key });

    const tag = `@${sender.split('@')[0]}`;

    if (action === 'delete') {
      // Silent delete — no warning message sent
      return;
    }

    if (action === 'kick') {
      // Silent kick — no warning message sent
      await sock.groupParticipantsUpdate(jid, [sender], 'remove');
      return;
    }

    if (action === 'warn') {
      // Delete + warn message + kick on max warns
      const count = await incrementWarningCount(jid, sender);
      if (count >= WARN_COUNT) {
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        await resetWarningCount(jid, sender);
        await sock.sendMessage(jid, {
          text: `${tag} has been removed for repeated group status mentions`,
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(jid, {
          text: `${tag} warning ${count}/${WARN_COUNT} — group status mentions are not allowed here`,
          mentions: [sender],
        });
      }
    }
  } catch (e) {
    console.error('[ANTIGROUPMENTION ERROR]', e);
  }
}

async function handleAntiGroupMentionCommand(jid, sender, args, sock) {
  if (!isJidGroup(jid)) return 'Group only command';

  const adminCheck = await isAdmin(sock, jid, sender);
  const isSenderAdmin =
    typeof adminCheck === 'boolean'
      ? adminCheck
      : adminCheck?.isSenderAdmin;

  if (!isSenderAdmin) return 'Admins only';

  const [mode, action] = args.split(' ');

  if (mode === 'on') {
    if (!['warn', 'kick', 'delete'].includes(action))
      return 'Usage: /antigroupmention on [warn|kick|delete]';

    await setAntigroupmention(jid, 'on', action);

    const descriptions = {
      delete: '✅ Antigroupmention enabled — group status mentions will be silently deleted',
      kick: '✅ Antigroupmention enabled — group status mentions will be deleted and sender kicked',
      warn: `✅ Antigroupmention enabled — group status mentions will be deleted and sender warned (kicked after ${WARN_COUNT} warns)`,
    };

    return descriptions[action];
  }

  if (mode === 'off') {
    await removeAntigroupmention(jid);
    return '✅ Antigroupmention disabled';
  }

  return 'Usage: /antigroupmention on|off [warn|kick|delete]';
}

module.exports = {
  AntiGroupMention,
  handleAntiGroupMentionCommand,
  isGroupStatusMention,
};
