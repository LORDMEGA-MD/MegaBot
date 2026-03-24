const fs = require('fs');

function readJsonSafe(path, fallback) {
    try {
        const txt = fs.readFileSync(path, 'utf8');
        return JSON.parse(txt);
    } catch (_) {
        return fallback;
    }
}

const isOwnerOrSudo = require('../lib/isOwner');

async function settingsCommand(sock, chatId, message) {
    try {
        const senderId = message.key.participant || message.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!message.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!' }, { quoted: message });
            return;
        }

        const isGroup = chatId.endsWith('@g.us');
        const dataDir = './data';

        const mode = readJsonSafe(`${dataDir}/messageCount.json`, { isPublic: true });
        const autoStatus = readJsonSafe(`${dataDir}/autoStatus.json`, { enabled: false });
        const autoread = readJsonSafe(`${dataDir}/autoread.json`, { enabled: false });
        const autotyping = readJsonSafe(`${dataDir}/autotyping.json`, { enabled: false });
        const pmblocker = readJsonSafe(`${dataDir}/pmblocker.json`, { enabled: false });
        const anticall = readJsonSafe(`${dataDir}/anticall.json`, { enabled: false });
        const userGroupData = readJsonSafe(`${dataDir}/userGroupData.json`, {
            antilink: {}, antibadword: {}, welcome: {}, goodbye: {}, chatbot: {}, antitag: {}
        });
        const autoReaction = Boolean(userGroupData.autoReaction);

        // Per-group features
        const groupId = isGroup ? chatId : null;
        const antilinkOn = groupId ? Boolean(userGroupData.antilink && userGroupData.antilink[groupId]) : false;
        
        const antistickerOn = groupId ? Boolean(userGroupData.antisticker && userGroupData.antisticker[groupId]) : false;
        const antigroupmentionOn = groupId ? Boolean(userGroupData.antigroupmention && userGroupData.antigroupmention[groupId]) : false;
        const antibotOn = groupId ? Boolean(userGroupData.antibot && userGroupData.antibot[groupId]) : false;
        
        
        const antibadwordOn = groupId ? Boolean(userGroupData.antibadword && userGroupData.antibadword[groupId]) : false;
        const welcomeOn = groupId ? Boolean(userGroupData.welcome && userGroupData.welcome[groupId]) : false;
        const goodbyeOn = groupId ? Boolean(userGroupData.goodbye && userGroupData.goodbye[groupId]) : false;
        const chatbotOn = groupId ? Boolean(userGroupData.chatbot && userGroupData.chatbot[groupId]) : false;
        const antitagCfg = groupId ? (userGroupData.antitag && userGroupData.antitag[groupId]) : null;

        const lines = [];
        lines.push('*MEGA-BOT SETTINGS*');
        lines.push('');
        lines.push(`> • Mode: ${mode.isPublic ? 'Public' : 'Private'}`);
        lines.push(`> • Auto Status: ${autoStatus.enabled ? 'ON' : 'OFF'}`);
        lines.push(`> • Autoread: ${autoread.enabled ? 'ON' : 'OFF'}`);
        lines.push(`> • Autotyping: ${autotyping.enabled ? 'ON' : 'OFF'}`);
        lines.push(`> • PM Blocker: ${pmblocker.enabled ? 'ON' : 'OFF'}`);
        lines.push(`> • Anticall: ${anticall.enabled ? 'ON' : 'OFF'}`);
        lines.push(`> • Auto Reaction: ${autoReaction ? 'ON' : 'OFF'}`);
        if (groupId) {
            lines.push('');
            lines.push(`*GROUP SETTINGS*\n\n> *GROUP ID: ${groupId}*`);
            if (antilinkOn) {
                const al = userGroupData.antilink[groupId];
                lines.push(`> • Antilink: ON (action: ${al.action || 'delete'})`);
            } else {
                lines.push('> • Antilink: OFF');
            }
            
            if (antistickerOn) {
                const al = userGroupData.antisticker[groupId];
                lines.push(`> • AntiSticker: ON (action: ${al.action || 'delete'})`);
            } else {
                lines.push('> • AntiSticker: OFF');
            }
            if (antibotOn) {
                const al = userGroupData.antibot[groupId];
                lines.push(`> • AntiBot: ON (action: ${al.action || 'delete'})`);
            } else {
                lines.push('> • AntiBot: OFF');
            }
            if (antigroupmentionOn) {
                const al = userGroupData.antigroupmention[groupId];
                lines.push(`> • AntiGroupMention: ON (action: ${al.action || 'delete'})`);
            } else {
                lines.push('> • AntiGroupMention: OFF');
            }
            
            
            if (antibadwordOn) {
                const ab = userGroupData.antibadword[groupId];
                lines.push(`> • Antibadword: ON (action: ${ab.action || 'delete'})`);
            } else {
                lines.push('> • Antibadword: OFF');
            }
            lines.push(`> • Welcome: ${welcomeOn ? 'ON' : 'OFF'}`);
            lines.push(`> • Goodbye: ${goodbyeOn ? 'ON' : 'OFF'}`);
            lines.push(`> • Chatbot: ${chatbotOn ? 'ON' : 'OFF'}`);
            if (antitagCfg && antitagCfg.enabled) {
                lines.push(`> • Antitag: ON (action: ${antitagCfg.action || 'delete'})`);
            } else {
                lines.push('> • Antitag: OFF');
            }
        } else {
            lines.push('');
            lines.push('> _*Note: Per-group settings will be shown when used inside a group.*_');
        }

        await sock.sendMessage(chatId, { text: lines.join('\n') }, { quoted: message });
    } catch (error) {
        console.error('Error in settings command:', error);
        await sock.sendMessage(chatId, { text: 'Failed to read settings.' }, { quoted: message });
    }
}

module.exports = settingsCommand;



