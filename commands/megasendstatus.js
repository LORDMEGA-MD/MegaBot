// megasendstatus.js
// .gstatus: post text or quoted media as group-scoped status (visible only to current group members)

const { proto, downloadMediaMessage } = require('@whiskeysockets/baileys');

/**
 * Sends status scoped to current group members
 */
async function sendGroupScopedStatus(sock, groupJid, content, options = {}) {
    if (!groupJid.endsWith('@g.us')) {
        throw new Error('Only works in groups');
    }

    let participants = [];
    try {
        const meta = await sock.groupMetadata(groupJid);
        participants = meta.participants
            .map(p => p.id)
            .filter(id => id !== sock.user?.id);

        if (participants.length === 0) throw new Error('No members');
    } catch (err) {
        throw new Error(`Group fetch failed: ${err.message}`);
    }

    const statusOptions = {
        broadcast: true,
        statusJidList: participants,
        backgroundColor: options.backgroundColor || '#000000',
        font: options.font || 0,
        ...options
    };

    try {
        const result = await sock.sendMessage('status@broadcast', content, statusOptions);
        console.log(`[GSTATUS] Sent | ${participants.length} recipients | Key: ${result?.key?.id}`);
        return result;
    } catch (err) {
        console.error('[GSTATUS SEND ERROR]', err.message || err);
        throw err;
    }
}

/**
 * Command handler: .gstatus [caption] (reply to media optional)
 */
async function handleGStatus(sock, message, chatId, textAfterCommand) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ Use .gstatus only in groups' });
        return;
    }

    const caption = textAfterCommand.trim() || '';

    let content = { text: caption || ' ' }; // default blank/fallback text

    // Check for quoted message with media
    const quotedContext = message.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedContext?.quotedMessage;

    if (quotedMsg) {
        try {
            // Download media from the quoted message
            const buffer = await downloadMediaMessage(
                { key: quotedContext.stanzaId ? { ...quotedContext, remoteJid: chatId } : message.key, message: quotedMsg },
                'buffer',
                {},
                { logger: sock.logger || console, reuploadRequest: sock.updateMediaMessage }
            );

            const msgType = Object.keys(quotedMsg)[0]; // e.g. imageMessage, videoMessage

            if (msgType === 'imageMessage') {
                content = { image: buffer, caption: caption || quotedMsg.imageMessage?.caption || ' ' };
            } else if (msgType === 'videoMessage') {
                content = { video: buffer, caption: caption || quotedMsg.videoMessage?.caption || ' ' };
            } else if (msgType === 'stickerMessage') {
                content = { sticker: buffer };
            } else if (msgType === 'documentMessage') {
                content = { document: buffer, mimetype: quotedMsg.documentMessage.mimetype, fileName: quotedMsg.documentMessage.fileName || 'doc', caption };
            } else {
                content = { text: caption || 'Quoted non-media message' };
            }

            console.log(`[GSTATUS] Quoted media type: ${msgType}`);
        } catch (downloadErr) {
            console.error('[GSTATUS DOWNLOAD ERROR]', downloadErr.message || downloadErr);
            content = { text: caption || 'Failed to download quoted media — posting text only' };
        }
    } else if (!caption) {
        await sock.sendMessage(chatId, { text: '❌ Reply to media or add text after .gstatus' });
        return;
    }

    try {
        await sendGroupScopedStatus(sock, chatId, content, {
            backgroundColor: '#1E90FF', // optional styling
            font: 2
        });

        await sock.sendMessage(chatId, { 
            text: ' *POSTED AS STATUS* !(scoped to group members)\n> _BY MEGA-BOT_' 
        }, { quoted: message });
    } catch (err) {
        await sock.sendMessage(chatId, { text: `❌ Failed to post: ${err.message}` }, { quoted: message });
    }
}

module.exports = {
    handleGStatus
};