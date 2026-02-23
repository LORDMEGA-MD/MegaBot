// megasender.js
async function megaSenderCommand(sock, chatId, message) {
    try {
        // Only allow in private chats
        if (chatId.endsWith("@g.us")) {
            return sock.sendMessage(chatId, {
                text: "> ❌ This command works in private chat only."
            }, { quoted: message });
        }

        // Extract text safely
        let text = "";
        if (message.message?.conversation) {
            text = message.message.conversation;
        } else if (message.message?.extendedTextMessage) {
            text = message.message.extendedTextMessage.text;
        } else {
            return;
        }

        text = text.trim();
        if (!text.startsWith(".send")) return;

        // Parse: !send "message" groupLink count
        const regex = /^.send\s+"([^"]+)"\s+(\S+)\s+(\d+)$/;
        const match = text.match(regex);

        if (!match) {
            return sock.sendMessage(chatId, {
                text: '> ❌ Usage:\n.send "message" groupLink count'
            }, { quoted: message });
        }

        const messageContent = match[1];
        const groupLink = match[2];
        const count = parseInt(match[3]);

        if (isNaN(count) || count < 1 || count > 50) {
            return sock.sendMessage(chatId, {
                text: "> ❌ Invalid count (1-50)"
            }, { quoted: message });
        }

        // Extract invite code from link
        const code = groupLink
            .split("/").pop()
            .split("?")[0];

        if (!code) {
            return sock.sendMessage(chatId, {
                text: "> ❌ Invalid group link"
            }, { quoted: message });
        }

        // Resolve to group JID
        let groupJid;
        try {
            const info = await sock.groupGetInviteInfo(code);
            groupJid = info.id; // real JID like 1203@g.us
        } catch (e) {
            return sock.sendMessage(chatId, {
                text: "> ❌ Failed to get group info.\n> _*Bot must be in the group already.*_"
            }, { quoted: message });
        }

        // Send messages with delay
        for (let i = 0; i < count; i++) {
            await sock.sendMessage(groupJid, { text: messageContent });
            await new Promise(r => setTimeout(r, 1));
        }

        // Confirm success
        await sock.sendMessage(chatId, {
            text: `> ✔️ Sent "${messageContent}" x${count} to group`
        }, { quoted: message });

    } catch (error) {
        console.error("MegaSender Error:", error);
        await sock.sendMessage(chatId, {
            text: "❌ Something went wrong while sending messages."
        }, { quoted: message });
    }
}

module.exports = megaSenderCommand;