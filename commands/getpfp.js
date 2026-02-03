async function getPfpCommand(sock, chatId, message) {
    try {
        let targetJid;

        // tagged
        if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetJid = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
        }
        // replied
        else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
            targetJid = message.message.extendedTextMessage.contextInfo.participant;
        }
        // typed by digs
        else if (message.message?.conversation) {
    const text = message.message.conversation.trim();

    // Mega filter 
    const numberText = text.replace(/^\.getpfp\s*/i, '');

    if (numberText) {
        let phone = numberText.replace(/\D/g, '');

        if (phone.length >= 8) { // basic sanity check
            targetJid = phone + '@s.whatsapp.net';
        }
    }
}

        //Default: sender
        if (!targetJid) {
            targetJid = message.key.participant || message.key.remoteJid;
        }

        // Fetch shit
        let pfpUrl;
        try {
            pfpUrl = await sock.profilePictureUrl(targetJid, 'image');
        } catch {
            pfpUrl = null;
        }

        if (!pfpUrl) {
            await sock.sendMessage(chatId, {
                text: '> MF MIGHT NOT BE HAVING A PFP OR ITS HIDDEN.'
            }, { quoted: message });
            return;
        }

        // Small delay  badmac counter 
        await new Promise(res => setTimeout(res, 700));

        await sock.sendMessage(chatId, {
            image: { url: pfpUrl },
            caption: `*🗿DONE, HERE IS @${targetJid.split('@')[0]}'s PFP*\n> EXTRACTED BY THE *MEGA-BOT.*`,
            mentions: [targetJid]
        }, { quoted: message });

    } catch (err) {
        console.error('getpfp error:', err);
    }
}

module.exports = getPfpCommand;