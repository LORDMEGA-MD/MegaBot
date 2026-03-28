const isAdmin = require('../lib/isAdmin');

/**
 * Normalizes a raw number string to a WhatsApp JID.
 * Strips +, spaces, dashes, brackets, and any non-digit characters.
 * Returns null if the result is too short to be a valid number.
 */
function toJid(raw) {
    const clean = raw.replace(/[^0-9]/g, '');
    if (!clean || clean.length < 7) return null;
    return clean + '@s.whatsapp.net';
}

/**
 * Extracts all JIDs to kick from:
 * 1. Numbers typed in the command (.kick 256xx 256xx)
 * 2. Quoted message sender (reply to someone's message with .kick)
 * 3. Mentioned JIDs (@user1 @user2)
 */
function extractTargets(userMessage, message) {
    const targets = new Set();

    // ── Source 1: numbers typed in command ────────────────────────────────────
    const rawArgs = userMessage
        .replace(/^\.kick\s*/i, '')
        .trim();

    if (rawArgs) {
        const parts = rawArgs.split(/[\s,;]+/).filter(Boolean);
        for (const part of parts) {
            // Skip @mentions (handled in source 3)
            if (part.startsWith('@')) continue;
            const jid = toJid(part);
            if (jid) targets.add(jid);
        }
    }

    // ── Source 2: quoted message sender ──────────────────────────────────────
    const quotedParticipant =
        message.message?.extendedTextMessage?.contextInfo?.participant ||
        message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.participant;

    if (quotedParticipant) {
        const jid = toJid(quotedParticipant);
        if (jid) targets.add(jid);
        else targets.add(quotedParticipant); // already a JID
    }

    // ── Source 3: @mentioned users ────────────────────────────────────────────
    const mentionedJids =
        message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    for (const jid of mentionedJids) {
        if (jid && !jid.endsWith('@g.us')) targets.add(jid);
    }

    return [...targets];
}

/**
 * Checks if any of the target JIDs match the bot itself.
 */
function isTargetingBot(usersToKick, sock, participants) {
    const botId = sock.user?.id || '';
    const botLid = sock.user?.lid || '';
    const botPhoneNumber = botId.includes(':')
        ? botId.split(':')[0]
        : botId.includes('@') ? botId.split('@')[0] : botId;
    const botIdFormatted = botPhoneNumber + '@s.whatsapp.net';
    const botLidNumeric = botLid.includes(':')
        ? botLid.split(':')[0]
        : botLid.includes('@') ? botLid.split('@')[0] : botLid;
    const botLidWithoutSuffix = botLid.includes('@') ? botLid.split('@')[0] : botLid;

    return usersToKick.some(userId => {
        const userPhoneNumber = userId.includes(':')
            ? userId.split(':')[0]
            : userId.includes('@') ? userId.split('@')[0] : userId;
        const userLidNumeric = userId.includes('@lid')
            ? userId.split('@')[0].split(':')[0]
            : '';

        const directMatch =
            userId === botId ||
            userId === botLid ||
            userId === botIdFormatted ||
            userPhoneNumber === botPhoneNumber ||
            (userLidNumeric && botLidNumeric && userLidNumeric === botLidNumeric);

        if (directMatch) return true;

        return participants.some(p => {
            const pPhoneNumber = p.phoneNumber ? p.phoneNumber.split('@')[0] : '';
            const pId = p.id ? p.id.split('@')[0] : '';
            const pLid = p.lid ? p.lid.split('@')[0] : '';
            const pFullId = p.id || '';
            const pFullLid = p.lid || '';
            const pLidNumeric = pLid.includes(':') ? pLid.split(':')[0] : pLid;

            const isThisParticipantBot =
                pFullId === botId ||
                pFullLid === botLid ||
                pLidNumeric === botLidNumeric ||
                pPhoneNumber === botPhoneNumber ||
                pId === botPhoneNumber ||
                p.phoneNumber === botIdFormatted ||
                (botLid && pLid && botLidWithoutSuffix === pLid);

            if (!isThisParticipantBot) return false;

            return (
                userId === pFullId ||
                userId === pFullLid ||
                userPhoneNumber === pPhoneNumber ||
                userPhoneNumber === pId ||
                userId === p.phoneNumber ||
                (pLid && userLidNumeric && userLidNumeric === pLidNumeric) ||
                (userLidNumeric && pLidNumeric && userLidNumeric === pLidNumeric)
            );
        });
    });
}

async function kickCommand(sock, chatId, senderId, userMessage, message) {
    const isOwner = message.key.fromMe;

    if (!isOwner) {
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, {
                text: 'Please make the bot an admin first.'
            }, { quoted: message });
            return;
        }

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, {
                text: 'Only group admins can use the kick command.'
            }, { quoted: message });
            return;
        }
    }

    // ── Extract targets ───────────────────────────────────────────────────────
    const usersToKick = extractTargets(userMessage, message);

    if (usersToKick.length === 0) {
        await sock.sendMessage(chatId, {
            text: `*Usage:*\n` +
                  `• .kick @user1 @user2\n` +
                  `• .kick 256700000000 256711111111\n` +
                  `• .kick +256700000000, +256711111111\n` +
                  `• Reply to a message with .kick to remove that person`
        }, { quoted: message });
        return;
    }

    // ── Fetch group metadata ──────────────────────────────────────────────────
    const metadata = await sock.groupMetadata(chatId);
    const participants = metadata.participants || [];

    // ── Bot self-kick protection ──────────────────────────────────────────────
    if (isTargetingBot(usersToKick, sock, participants)) {
        await sock.sendMessage(chatId, {
            text: "I can't kick myself 🤖"
        }, { quoted: message });
        return;
    }

    // ── Filter out users not in group ─────────────────────────────────────────
    const participantIds = participants.map(p => p.id);
    const validUsers = usersToKick.filter(jid => participantIds.includes(jid));
    const notInGroup = usersToKick.filter(jid => !participantIds.includes(jid));

    // ── Kick in batches of 5 ──────────────────────────────────────────────────
    const kicked = [];
    const failed = [];

    for (let i = 0; i < validUsers.length; i += 5) {
        const batch = validUsers.slice(i, i + 5);
        try {
            await sock.groupParticipantsUpdate(chatId, batch, 'remove');
            kicked.push(...batch);
        } catch (err) {
            console.error('[KICK] Batch error:', err.message);
            failed.push(...batch);
        }
        if (i + 5 < validUsers.length) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // ── Build response ────────────────────────────────────────────────────────
    let responseText = '';

    if (kicked.length > 0) {
        const tags = kicked.map(j => `@${j.split('@')[0]}`).join(', ');
        responseText += `✅ Kicked: ${tags}\n`;
    }

    if (notInGroup.length > 0) {
        const tags = notInGroup.map(j => `@${j.split('@')[0]}`).join(', ');
        responseText += `ℹ️ Not in group: ${tags}\n`;
    }

    if (failed.length > 0) {
        const tags = failed.map(j => `@${j.split('@')[0]}`).join(', ');
        responseText += `❌ Failed to kick: ${tags}\n`;
    }

    await sock.sendMessage(chatId, {
        text: responseText.trim(),
        mentions: usersToKick
    }, { quoted: message });
}

module.exports = kickCommand;
