// megastatus.js
// .gstatus: post text or quoted media as group-scoped status (visible only to current group members)

const {
  generateWAMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const { PassThrough } = require('stream');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

const MEGA_BG = '#2196F3';

/**
 * Handler for .gstatus command
 * Supports: group, PM, optional target group JID, quoted media
 */
async function handleGStatus(sock, msg) {
  try {
    const from = msg.key?.remoteJid;
    if (!from) return;

    // Parse command: .gstatus [optional targetGroupJid] [caption...]
    const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const cmdMatch = body.match(/^\.(?:gstatus|gst)\s+([\s\S]+)/);
    if (!cmdMatch) {
      return sock.sendMessage(from, { text: '> Usage: .gstatus [targetGroupJid] caption' }, { quoted: msg });
    }

    // Split optional target JID from caption
    let rawText = cmdMatch[1].trim();
    let targetGroupJid = from; // default to current chat
    let caption = rawText;

    // If text contains something that looks like a group JID at start, use it
    const gidMatch = rawText.match(/^(\d+@g\.us)\s+([\s\S]+)/);
    if (gidMatch) {
      targetGroupJid = gidMatch[1];
      caption = gidMatch[2];
    }

    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctxInfo?.quotedMessage;
    const hasQuoted = !!quotedMsg;

    // --- TEXT STATUS ---
    if (!hasQuoted) {
      if (!caption) {
        return sock.sendMessage(from, {
          text:
            '> *Group Status Usage*\n\n' +
            ' • Reply to image/video/audio with:\n' +
            '   `.gstatus [optional targetGroupJid] [optional caption]`\n' +
            ' • Or send text status only:\n' +
            '   `.gstatus [optional targetGroupJid] Your text here`\n\n' +
            'Text statuses use a blue BG.'
        }, { quoted: msg });
      }

      await groupStatus(sock, targetGroupJid, {
        text: caption,
        backgroundColor: MEGA_BG
      });

      // Optional: notify in sender chat that status posted
      return sock.sendMessage(from, {
        text: ` *POSTED AS STATUS ${targetGroupJid}\nCaption: ${caption}\n> _BY MEGA-BOT_`
      }, { quoted: msg });
    }

    // --- QUOTED MEDIA STATUS ---
    const targetMessage = {
      key: {
        remoteJid: targetGroupJid,
        id: ctxInfo.stanzaId,
        participant: ctxInfo.participant
      },
      message: quotedMsg
    };

    const msgType = Object.keys(targetMessage.message)[0] || '';

    const downloadBuf = async () => {
      const qmsg = targetMessage.message;
      if (/image/i.test(msgType)) return await downloadMedia(qmsg, 'image');
      if (/video/i.test(msgType)) return await downloadMedia(qmsg, 'video');
      if (/audio/i.test(msgType)) return await downloadMedia(qmsg, 'audio');
      if (/sticker/i.test(msgType)) return await downloadMedia(qmsg, 'sticker');
      return null;
    };

    const buf = await downloadBuf();
    if (!buf) return sock.sendMessage(from, { text: '> Could not download quoted media' }, { quoted: msg });

    // Construct content object depending on media type
    let content = {};
    if (/image/i.test(msgType)) content = { image: buf, caption };
    else if (/video/i.test(msgType)) content = { video: buf, caption };
    else if (/audio/i.test(msgType)) content = { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true };
    else if (/sticker/i.test(msgType)) content = { sticker: buf };
    else content = { text: caption };

    await groupStatus(sock, targetGroupJid, content);

    return sock.sendMessage(from, {
      text: ` *POSTED AS GROUP STATUS* \n> _BY MEGA-BOT_`
    }, { quoted: msg });

  } catch (e) {
    console.error('[GSTATUS ERROR]', e);
    return sock.sendMessage(msg.key.remoteJid, { text: '❌ Error: ' + (e.message || e) }, { quoted: msg });
  }
}

// --- Helpers ---
async function downloadMedia(msg, type) {
  const mediaMsg = msg[`${type}Message`] || msg;
  const stream = await downloadContentFromMessage(mediaMsg, type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function groupStatus(sock, jid, content) {
  const { backgroundColor } = content;
  delete content.backgroundColor;

  const inside = await generateWAMessageContent(content, {
    upload: sock.waUploadToServer,
    backgroundColor: backgroundColor || MEGA_BG
  });

  const secret = crypto.randomBytes(32);

  const msg = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: { messageSecret: secret },
      groupStatusMessageV2: {
        message: {
          ...inside,
          messageContextInfo: { messageSecret: secret }
        }
      }
    },
    {}
  );

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
}

module.exports = { handleGStatus };
