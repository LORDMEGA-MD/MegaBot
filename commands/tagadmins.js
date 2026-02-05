const isOwner = require('../lib/isOwner');

async function tagAdminsCommand(sock, chatId, senderId, message) {
    try {

        // ✅ Owner only
        if (!isOwner(senderId)) {
            return;
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants || [];

        // ✅ Get admins only
        const admins = participants.filter(p => p.admin).map(p => p.id);

        if (admins.length === 0) {
            await sock.sendMessage(chatId, { text: 'No admin members to tag.' }, { quoted: message });
            return;
        }

        let text = '🔊 *Hello Admins:*\n\n';

        admins.forEach(jid => {
            text += `@${jid.split('@')[0]}\n`;
        });

        await sock.sendMessage(chatId, { text, mentions: admins }, { quoted: message });

    } catch (error) {
        console.error('Error in tagadmins command:', error);
        await sock.sendMessage(chatId, { text: 'Failed to tag admin members.' }, { quoted: message });
    }
}

module.exports = tagAdminsCommand;