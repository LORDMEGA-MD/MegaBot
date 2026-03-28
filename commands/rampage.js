const isAdmin = require('../lib/isAdmin');

/**
 * Demotes all admins in a group except the bot and the command sender.
 * Usage: .demoteall
 */
async function demoteAllCommand(sock, chatId, senderId, message) {
    try {
        const isOwner = message.key.fromMe;

        if (!isOwner) {
            const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Please make the bot an admin first.'
                }, { quoted: message });
                return;
            }

            if (!isSenderAdmin) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Only group admins can use this command.'
                }, { quoted: message });
                return;
            }
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Get all admins except bot and sender
        const adminsToDemote = participants.filter(p => {
            const pJid = p.id.split(':')[0] + '@s.whatsapp.net';
            const isBot = pJid === botJid;
            const isSender = p.id === senderId || pJid === senderId.split(':')[0] + '@s.whatsapp.net';
            const isAnAdmin = p.admin === 'admin' || p.admin === 'superadmin';
            return isAnAdmin && !isBot && !isSender;
        }).map(p => p.id);

        if (adminsToDemote.length === 0) {
            await sock.sendMessage(chatId, {
                text: '❌ No admins to demote.'
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: `⏳ Demoting ${adminsToDemote.length} admin(s)...`
        }, { quoted: message });

        // Demote in batches of 5 to avoid rate limiting
        for (let i = 0; i < adminsToDemote.length; i += 5) {
            const batch = adminsToDemote.slice(i, i + 5);
            try {
                await sock.groupParticipantsUpdate(chatId, batch, 'demote');
            } catch (err) {
                console.error('[DEMOTEALL] Batch error:', err.message);
            }
            if (i + 5 < adminsToDemote.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const tags = adminsToDemote.map(j => `@${j.split('@')[0]}`).join(', ');
        await sock.sendMessage(chatId, {
            text: `✅ Demoted ${adminsToDemote.length} admin(s):\n${tags}`,
            mentions: adminsToDemote
        }, { quoted: message });

    } catch (err) {
        console.error('[DEMOTEALL ERROR]', err);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to demote all admins: ' + err.message
        }, { quoted: message });
    }
}

/**
 * Promotes all members in a group to admin except those already admin.
 * Usage: .promoteall
 */
async function promoteAllCommand(sock, chatId, senderId, message) {
    try {
        const isOwner = message.key.fromMe;

        if (!isOwner) {
            const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Please make the bot an admin first.'
                }, { quoted: message });
                return;
            }

            if (!isSenderAdmin) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Only group admins can use this command.'
                }, { quoted: message });
                return;
            }
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        // Get all non-admin members
        const membersToPromote = participants.filter(p => {
            return !p.admin;
        }).map(p => p.id);

        if (membersToPromote.length === 0) {
            await sock.sendMessage(chatId, {
                text: '❌ All members are already admins.'
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: `⏳ Promoting ${membersToPromote.length} member(s) to admin...`
        }, { quoted: message });

        // Promote in batches of 5 to avoid rate limiting
        for (let i = 0; i < membersToPromote.length; i += 5) {
            const batch = membersToPromote.slice(i, i + 5);
            try {
                await sock.groupParticipantsUpdate(chatId, batch, 'promote');
            } catch (err) {
                console.error('[PROMOTEALL] Batch error:', err.message);
            }
            if (i + 5 < membersToPromote.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const tags = membersToPromote.map(j => `@${j.split('@')[0]}`).join(', ');
        await sock.sendMessage(chatId, {
            text: `✅ Promoted ${membersToPromote.length} member(s) to admin:\n${tags}`,
            mentions: membersToPromote
        }, { quoted: message });

    } catch (err) {
        console.error('[PROMOTEALL ERROR]', err);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to promote all members: ' + err.message
        }, { quoted: message });
    }
}

/**
 * Kicks all members in a group except the bot and the command sender.
 * Usage: .kickall
 */
async function kickAllCommand(sock, chatId, senderId, message) {
    try {
        const isOwner = message.key.fromMe;

        if (!isOwner) {
            const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Please make the bot an admin first.'
                }, { quoted: message });
                return;
            }

            if (!isSenderAdmin) {
                await sock.sendMessage(chatId, {
                    text: '⚠️ Only group admins can use this command.'
                }, { quoted: message });
                return;
            }
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];

        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        // Get all members except bot and sender
        const membersToKick = participants.filter(p => {
            const pJid = p.id.split(':')[0] + '@s.whatsapp.net';
            const isBot = pJid === botJid;
            const isSender = p.id === senderId || pJid === senderId.split(':')[0] + '@s.whatsapp.net';
            return !isBot && !isSender;
        }).map(p => p.id);

        if (membersToKick.length === 0) {
            await sock.sendMessage(chatId, {
                text: '❌ No members to kick.'
            }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, {
            text: `⏳ Kicking ${membersToKick.length} member(s)...`
        }, { quoted: message });

        // Kick in batches of 5 to avoid rate limiting
        for (let i = 0; i < membersToKick.length; i += 5) {
            const batch = membersToKick.slice(i, i + 5);
            try {
                await sock.groupParticipantsUpdate(chatId, batch, 'remove');
            } catch (err) {
                console.error('[KICKALL] Batch error:', err.message);
            }
            if (i + 5 < membersToKick.length) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        // Silent — no tags, no mentions
        await sock.sendMessage(chatId, {
            text: `✅ Kicked ${membersToKick.length} member(s).`
        }, { quoted: message });

    } catch (err) {
        console.error('[KICKALL ERROR]', err);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to kick all members: ' + err.message
        }, { quoted: message });
    }
}

module.exports = {
    demoteAllCommand,
    promoteAllCommand,
    kickAllCommand
};