
const {
  generateWAMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage,
} = require('@whiskeysockets/baileys')

const { PassThrough } = require('stream')
const ffmpeg = require('fluent-ffmpeg')
const crypto = require('crypto')

const MEGA_BG = '#2196F3'

async function handleGStatus(sock, msg, chatId) {

  const from = chatId || msg?.key?.remoteJid
  if (!from) return

  if (!from.endsWith('@g.us')) {
    return sock.sendMessage(from, {
      text: '> This command can only be used in groups.'
    })
  }

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ""

  const caption = body.split(' ').slice(1).join(' ').trim()

  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo
  const hasQuoted = !!ctxInfo?.quotedMessage

  try {

    // TEXT STATUS
    if (!hasQuoted) {

      if (!caption) {
        return sock.sendMessage(from, {
          text:
            '> *Group Status Usage*\n\n' +
            ' • Reply to image/video/audio with:\n' +
            '  `.gstatus [optional caption]`\n' +
            '• Or send text status only:\n' +
            '  `.gstatus Your text here`\n\n' +
            'Text statuses use a blue BG.'
        }, { quoted: msg })
      }


      await groupStatus(sock, from, {
        text: caption,
        backgroundColor: MEGA_BG
      })

      return sock.sendMessage(from, {
        text: '*POSTED AS STATUS* !(scoped to group members)\n> _BY MEGA-BOT_'
      }, { quoted: msg })
    }

    // QUOTED MEDIA
    const targetMessage = {
      key: {
        remoteJid: from,
        id: ctxInfo.stanzaId,
        participant: ctxInfo.participant,
      },
      message: ctxInfo.quotedMessage
    }

    const mtype = Object.keys(targetMessage.message)[0] || ''

    const downloadBuf = async () => {
      const qmsg = targetMessage.message
      if (/image/i.test(mtype)) return await downloadMedia(qmsg, 'image')
      if (/video/i.test(mtype)) return await downloadMedia(qmsg, 'video')
      if (/audio/i.test(mtype)) return await downloadMedia(qmsg, 'audio')
      if (/sticker/i.test(mtype)) return await downloadMedia(qmsg, 'sticker')
      return null
    }

    // IMAGE / STICKER
    if (/image|sticker/i.test(mtype)) {


      const buf = await downloadBuf()
      if (!buf) return sock.sendMessage(from, { text: '>  Could not download image' }, { quoted: msg })

      await groupStatus(sock, from, {
        image: buf,
        caption: caption || ''
      })

      return sock.sendMessage(from, {
        text: '*POSTED AS STATUS* !(scoped to group members)\n> _BY MEGA-BOT_'
      }, { quoted: msg })
    }

    // VIDEO
    if (/video/i.test(mtype)) {


      const buf = await downloadBuf()
      if (!buf) return sock.sendMessage(from, { text: '> Could not download video' }, { quoted: msg })

      await groupStatus(sock, from, {
        video: buf,
        caption: caption || ''
      })

      return sock.sendMessage(from, {
        text: '*POSTED AS STATUS* !(scoped to group members)\n> _BY MEGA-BOT_'
      }, { quoted: msg })
    }

    // AUDIO
    if (/audio/i.test(mtype)) {


      const buf = await downloadBuf()
      if (!buf) return sock.sendMessage(from, { text: '> Could not download audio' }, { quoted: msg })

      let vn
      try { vn = await toVN(buf) } catch { vn = buf }

      let waveform
      try { waveform = await generateWaveform(buf) } catch { waveform = undefined }

      await groupStatus(sock, from, {
        audio: vn,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        waveform
      })

      return sock.sendMessage(from, {
        text: '*POSTED AS STATUS* !(scoped to group members)\n> _BY MEGA-BOT_'
      }, { quoted: msg })
    }

    return sock.sendMessage(from, {
      text: '> ❌ Unsupported media type.'
    }, { quoted: msg })

  } catch (e) {

    console.error('groupstatus error:', e)

    return sock.sendMessage(from, {
      text: '❌ Error: ' + (e.message || e)
    }, { quoted: msg })
  }
}

module.exports = { handleGStatus }


// ---------- Helpers ----------

async function downloadMedia(msg, type) {
  const mediaMsg = msg[`${type}Message`] || msg
  const stream = await downloadContentFromMessage(mediaMsg, type)

  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)

  return Buffer.concat(chunks)
}

async function groupStatus(sock, jid, content) {

  const { backgroundColor } = content
  delete content.backgroundColor

  const inside = await generateWAMessageContent(content, {
    upload: sock.waUploadToServer,
    backgroundColor: backgroundColor || MEGA_BG
  })

  const secret = crypto.randomBytes(32)

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
  )

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
  }
