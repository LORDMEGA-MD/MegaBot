const isAdmin = require('../lib/isAdmin');
const store = require('../lib/lightweight_store');

async function cleanCommand(sock, chatId, message, senderId) {
    console.log("CLEAN COMMAND TRIGGERED");
    try {
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

        if (!isBotAdmin) {
            return sock.sendMessage(chatId, {
                text: 'I need to be admin to delete messages.'
            }, { quoted: message });
        }

        if (!isSenderAdmin) {
            return sock.sendMessage(chatId, {
                text: 'Only admins can use this command.'
            }, { quoted: message });
        }

        const text =
            message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            '';

        const parts = text.trim().split(/\s+/);
        const countArg = Math.min(parseInt(parts[1], 10) || 0, 50);

        if (!countArg || countArg < 1) {
            return sock.sendMessage(chatId, {
                text: 'Usage: .clean 5'
            }, { quoted: message });
        }

        const metadata = await sock.groupMetadata(chatId);

        const adminIds = metadata.participants
            .filter(p => p.admin !== null)
            .map(p => p.id.split(':')[0]);

        const chatMessages = Array.isArray(store.messages[chatId])
            ? store.messages[chatId]
            : [];

        if (!chatMessages.length) {
            return sock.sendMessage(chatId, {
                text: 'No messages stored.'
            }, { quoted: message });
        }

        const toDelete = [];
        const seen = new Set();

        for (let i = chatMessages.length - 1; i >= 0 && toDelete.length < countArg; i--) {
            const m = chatMessages[i];
            if (!m?.key?.id || seen.has(m.key.id)) continue;

            const sender = (m.key.participant || m.key.remoteJid || '').split(':')[0];

            if (m.message?.protocolMessage) continue;
            if (m.key.fromMe) continue;
            if (adminIds.includes(sender)) continue;
            if (m.key.id === message.key.id) continue;

            toDelete.push(m);
            seen.add(m.key.id);
        }

        if (!toDelete.length) {
            return sock.sendMessage(chatId, {
                text: 'No non-admin messages found.'
            }, { quoted: message });
        }

        for (const m of toDelete) {
            try {
                await sock.sendMessage(chatId, {
                    delete: {
                        remoteJid: chatId,
                        fromMe: false,
                        id: m.key.id,
                        participant: m.key.participant
                    }
                });
                await new Promise(r => setTimeout(r, 250));
            } catch {}
        }

    } catch (err) {
        console.log('CLEAN ERROR:', err);
        await sock.sendMessage(chatId, {
            text: 'Failed to delete messages.'
        }, { quoted: message });
    }
}

module.exports = cleanCommand;