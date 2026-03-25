const isAdmin = require('../lib/isAdmin');

/**
 * Normalizes a raw number string to a WhatsApp JID.
 * Strips +, spaces, dashes, brackets, and any non-digit characters.
 * Returns null if the result is too short to be a valid number.
 */
function toJid(raw) {
    const clean = raw.replace(/[^0-9]/g, ''); // strip everything except digits
    if (!clean || clean.length < 7) return null;
    return clean + '@s.whatsapp.net';
}

/**
 * Extracts all JIDs to add from:
 * 1. Numbers typed in the command (.add 256xx 256xx)
 * 2. Quoted message sender (reply to someone's message with .add)
 * 3. Mentioned JIDs in the command message
 */
function extractTargets(userMessage, message) {
    const targets = new Set();

    // ── Source 1: numbers typed in command ────────────────────────────────────
    const rawArgs = userMessage
        .replace(/^\.add\s*/i, '')
        .trim();

    if (rawArgs) {
        // Split by spaces, commas, or semicolons
        const parts = rawArgs.split(/[\s,;]+/).filter(Boolean);
        for (const part of parts) {
            const jid = toJid(part);
            if (jid) targets.add(jid);
        }
    }

    // ── Source 2: quoted message sender ──────────────────────────────────────
    // When admin replies to a removed member's message with .add
    const quotedParticipant =
        message.message?.extendedTextMessage?.contextInfo?.participant ||
        message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.participant;

    if (quotedParticipant) {
        const jid = toJid(quotedParticipant);
        if (jid) targets.add(jid);
    }

    // Also grab the remoteJid of the quoted message in case it's a DM quote
    const quotedRemoteJid =
        message.message?.extendedTextMessage?.contextInfo?.remoteJid;

    if (quotedRemoteJid && !quotedRemoteJid.endsWith('@g.us') && !quotedRemoteJid.endsWith('@broadcast')) {
        const jid = toJid(quotedRemoteJid);
        if (jid) targets.add(jid);
    }

    // ── Source 3: @mentioned users in the command ─────────────────────────────
    const mentionedJids =
        message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    for (const jid of mentionedJids) {
        if (jid && !jid.endsWith('@g.us')) targets.add(jid);
    }

    return [...targets];
}

async function addCommand(sock, chatId, senderId, userMessage, message) {
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
                text: 'Only group admins can use the add command.'
            }, { quoted: message });
            return;
        }
    }

    // ── Extract targets ───────────────────────────────────────────────────────
    const usersToAdd = extractTargets(userMessage, message);

    if (usersToAdd.length === 0) {
        await sock.sendMessage(chatId, {
            text: `*Usage:*\n` +
                  `• .add 256700000000\n` +
                  `• .add 256700000000 256711111111 256722222222\n` +
                  `• .add +256700000000 +256711111111\n` +
                  `• Reply to a message with .add to re-add that person\n\n` +
                  `Numbers can include +, spaces or dashes — they will be cleaned automatically.`
        }, { quoted: message });
        return;
    }

    // ── Get group invite link for fallback ────────────────────────────────────
    let inviteLink = '';
    try {
        const code = await sock.groupInviteCode(chatId);
        inviteLink = `https://chat.whatsapp.com/${code}`;
    } catch {}

    // ── Get current participants ───────────────────────────────────────────────
    let currentParticipants = [];
    try {
        const metadata = await sock.groupMetadata(chatId);
        currentParticipants = (metadata.participants || []).map(p => p.id);
    } catch {}

    // ── Add each user ─────────────────────────────────────────────────────────
    const added = [];
    const failed = [];
    const alreadyIn = [];

    for (const jid of usersToAdd) {
        if (currentParticipants.includes(jid)) {
            alreadyIn.push(jid);
            continue;
        }

        try {
            const result = await sock.groupParticipantsUpdate(chatId, [jid], 'add');
            const participantResult = result?.[0];
            const status = participantResult?.status || participantResult?.content?.attrs?.code;

            if (
                status === 200 ||
                status === '200' ||
                participantResult?.status === 'added' ||
                !status
            ) {
                added.push(jid);
            } else if (status === 403 || status === '403') {
                failed.push({ jid, reason: 'privacy' });
            } else if (status === 408 || status === '408') {
                failed.push({ jid, reason: 'not_on_wa' });
            } else {
                failed.push({ jid, reason: 'unknown' });
            }
        } catch (err) {
            console.error(`[ADD] Failed to add ${jid}:`, err.message);
            failed.push({ jid, reason: 'error' });
        }
    }

    // ── Build response ────────────────────────────────────────────────────────
    let responseText = '';

    if (added.length > 0) {
        const tags = added.map(j => `@${j.split('@')[0]}`).join(', ');
        responseText += `✅ Successfully added: ${tags}\n`;
    }

    if (alreadyIn.length > 0) {
        const tags = alreadyIn.map(j => `@${j.split('@')[0]}`).join(', ');
        responseText += `ℹ️ Already in group: ${tags}\n`;
    }

    if (failed.length > 0) {
        responseText += `\n❌ Could not add:\n`;
        for (const { jid, reason } of failed) {
            const num = jid.split('@')[0];
            if (reason === 'privacy') {
                responseText += `• @${num} — privacy settings (invite link sent)\n`;
            } else if (reason === 'not_on_wa') {
                responseText += `• @${num} — not on WhatsApp\n`;
            } else {
                responseText += `• @${num} — failed\n`;
            }
        }
    }

    await sock.sendMessage(chatId, {
        text: responseText.trim(),
        mentions: [...added, ...alreadyIn, ...failed.map(f => f.jid)]
    }, { quoted: message });

    // ── Send invite link to privacy-blocked contacts ──────────────────────────
    const privacyBlocked = failed.filter(f => f.reason === 'privacy');
    for (const { jid } of privacyBlocked) {
        if (!inviteLink) continue;
        try {
            await sock.sendMessage(jid, {
                text: `👋 Hello! You were invited to join our WhatsApp group but your privacy settings prevented a direct add.\n\nJoin using this link:\n${inviteLink}`
            });
            console.log(`[ADD] Invite sent to ${jid}`);
        } catch (err) {
            console.error(`[ADD] Could not send invite to ${jid}:`, err.message);
        }
    }
}

module.exports = addCommand;
