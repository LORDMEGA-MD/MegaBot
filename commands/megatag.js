const { jidNormalizedUser } = require('@whiskeysockets/baileys');

async function megaTagCommand(sock, chatId, senderId, userMessage, message) {
    try {

        if (chatId.endsWith('@g.us')) {
            return sock.sendMessage(chatId, {
                text: "> MF please Use this command in bots DM🙏."
            }, { quoted: message });
        }

        let content = userMessage.replace('.megatag', '').trim();

        // -------- Extract Group From JID --------
        let groupId = null;

        const groupMatch = content.match(/\d+@g\.us/);
        if (groupMatch) {
            groupId = groupMatch[0];
            content = content.replace(groupId, '').trim();
        }

        // -------- Extract Group From Link --------
        const inviteMatch = content.match(/chat\.whatsapp\.com\/([\w\d]+)/);

        if (inviteMatch) {
            try {
                groupId = await sock.groupAcceptInvite(inviteMatch[1]);
                content = content.replace(inviteMatch[0], '').trim();
            } catch {
                return sock.sendMessage(chatId, {
                    text: "> Invalid or expired group link."
                }, { quoted: message });
            }
        }

        if (!groupId) {
            return sock.sendMessage(chatId, {
                text: "> Provide group link or group JID."
            }, { quoted: message });
        }

        // -------- Detect All Phone Numbers --------
        const numberRegex = /\+?\d[\d\s]{7,18}\d/g;
        const foundNumbers = content.match(numberRegex) || [];

        if (!foundNumbers.length) {
            return sock.sendMessage(chatId, {
                text: "> No valid numbers found."
            }, { quoted: message });
        }

        let finalText = content;
        let numbers = [];

        // Inline replace numbers
        for (let rawNum of foundNumbers) {

            const cleanNum = rawNum.replace(/\D/g, '');

            if (cleanNum.length < 9 || cleanNum.length > 15) continue;

            numbers.push(cleanNum);

            finalText = finalText.replace(rawNum, `@${cleanNum}`);
        }

        numbers = [...new Set(numbers)];

        // Convert numbers → JIDs
        const targetJids = numbers.map(num =>
            jidNormalizedUser(num + "@s.whatsapp.net")
        );

        // -------- Hidetag Everyone --------
        const groupMeta = await sock.groupMetadata(groupId);
        const participants = groupMeta.participants.map(p => p.id);

        await sock.sendMessage(groupId, {
            text: finalText,
            mentions: [...participants, ...targetJids]
        });

        await sock.sendMessage(chatId, {
            text: `> ✅ Megatag sent to ${numbers.length} user(s).`
        });

    } catch (err) {
        console.log(err);
        await sock.sendMessage(chatId, {
            text: "> Failed to send megatag."
        }, { quoted: message });
    }
}

module.exports = megaTagCommand;