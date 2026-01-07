const { isJidGroup } = require('@whiskeysockets/baileys');
const {
  getAntisticker,
  incrementWarningCount,
  resetWarningCount,
  isSudo,
  setAntisticker,
  removeAntisticker
} = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const config = require('../config');

const WARN_COUNT = config.WARN_COUNT || 3;

function isSticker(msg) {
  const m = msg?.message;
  return Boolean(
    m?.stickerMessage ||
    m?.ephemeralMessage?.message?.stickerMessage ||
    m?.viewOnceMessage?.message?.stickerMessage ||
    m?.viewOnceMessageV2?.message?.stickerMessage ||
    m?.viewOnceMessageV2Extension?.message?.stickerMessage
  );
}
/**
 * AUTO sticker handler
 * call this from main ONCE per message
 */
async function AntiSticker(msg, sock) {
  try {
    if (!msg?.key?.remoteJid) return;

    const jid = msg.key.remoteJid;
    if (!isJidGroup(jid)) return;
    if (!isSticker(msg)) return;

    const sender = msg.key.participant;
    if (!sender) return;

    if (await isSudo(sender)) return;

    const adminCheck = await isAdmin(sock, jid, sender);
    const isSenderAdmin =
      typeof adminCheck === 'boolean'
        ? adminCheck
        : adminCheck?.isSenderAdmin;

    if (isSenderAdmin) return;

    //const configData = await getAntisticker(jid);
    const configData = await getAntisticker(jid, 'on');
    if (!configData?.enabled) return;

    const action = configData.action || 'delete';

    // delete sticker
    await sock.sendMessage(jid, { delete: msg.key });

    const tag = `@${sender.split('@')[0]}`;

    if (action === 'delete') {
      return sock.sendMessage(jid, {
        text: `${tag} stickers are not allowed here`,
        mentions: [sender]
      });
    }

    if (action === 'kick') {
      await sock.groupParticipantsUpdate(jid, [sender], 'remove');
      return;
    }

    if (action === 'warn') {
      const count = await incrementWarningCount(jid, sender);

      if (count >= WARN_COUNT) {
        await sock.groupParticipantsUpdate(jid, [sender], 'remove');
        await resetWarningCount(jid, sender);
      } else {
        await sock.sendMessage(jid, {
          text: `${tag} warning ${count}/${WARN_COUNT}`,
          mentions: [sender]
        });
      }
    }
  } catch (e) {
    console.error('[ANTISTICKER ERROR]', e);
  }
}

/**
 * COMMAND handler ONLY
 * main calls this when /antisticker is used
 */
async function handleAntiStickerCommand(jid, sender, args, sock) {
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
      return 'Use: warn | kick | delete';

    await setAntisticker(jid, 'on', action);
    return `Antisticker enabled (${action})`;
  }

  if (mode === 'off') {
    await removeAntisticker(jid);
    return 'Antisticker disabled';
  }

  return 'Usage: /antisticker on|off [warn|kick|delete]';
}

module.exports = {
  AntiSticker,
  handleAntiStickerCommand
};