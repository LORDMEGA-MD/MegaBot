// lib/megavo.js

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function handleViewOnceSaver(sock, message, rawText) {
    const quotedContext = message.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedContext?.quotedMessage;

    if (!quotedMsg) return;

    const replyText = rawText.trim();

    // Check if reply ENDS WITH an emoji (last character)
    const endsWithEmoji = /[\p{Emoji_Presentation}\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Extended_Pictographic}]$/u.test(replyText);

    if (!endsWithEmoji) return;

    try {
        let mediaObj = null;
        let mediaType = '';
        let ext = '';
        let mime = '';
        let ptt = false;

        const quotedImage = quotedMsg.imageMessage;
        const quotedVideo = quotedMsg.videoMessage;
        const quotedAudio = quotedMsg.audioMessage;

        if (quotedImage?.viewOnce) {
            mediaObj = quotedImage;
            mediaType = 'image';
            ext = 'jpg';
            mime = 'image/jpeg';
        } else if (quotedVideo?.viewOnce) {
            mediaObj = quotedVideo;
            mediaType = 'video';
            ext = 'mp4';
            mime = 'video/mp4';
        } else if (quotedAudio?.viewOnce) {
            mediaObj = quotedAudio;
            mediaType = 'audio';
            ext = 'ogg';
            mime = 'audio/ogg; codecs=opus';
            ptt = true; // send as voice note (PTT)
        }

        if (!mediaObj) return; // silent skip if no matching view-once media

        // Download using stream (exact same as antidelete)
        const stream = await downloadContentFromMessage(mediaObj, mediaType);

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (buffer.length === 0) {
            console.log(`[MEGAVO] Empty buffer for ${mediaType} — likely blocked by WhatsApp`);
            return;
        }

        // Get bot's own number (exact antidelete style)
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        const originalCaption = mediaObj.caption || `Auto-saved view-once ${mediaType}`;

        // Prepare send options
        const sendOptions = {
            [mediaType]: buffer,
            mimetype: mime,
            fileName: `megavo-\( {mediaType}. \){ext}`,
            caption: originalCaption
        };

        // For audio voice notes — send as PTT
        if (ptt) {
            sendOptions.ptt = true;
            sendOptions.seconds = mediaObj.seconds || 0; // preserve duration if available
        }

        // Send silently to self-chat
        await sock.sendMessage(ownerNumber, sendOptions);

        console.log(`[MEGAVO SAVED] → ${ownerNumber} | ${mediaType} | size: ${buffer.length} bytes`);

    } catch (err) {
        console.error('[MEGAVO ERROR]', err.message || err);
        // Fully silent — no feedback to user/group
    }
}

module.exports = {
    handleViewOnceSaver
};