const os = require('os');
const settings = require('../settings.js');

function formatTime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);

    let time = '';
    if (days > 0) time += `${days}d `;
    if (hours > 0) time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;

    return time.trim();
}

async function pingCommand(sock, chatId, message) {
    try {
        // Send Pong to bot's own DM — invisible to group, real round trip
        const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net'

        const start = Date.now()
        await sock.sendMessage(botJid, { text: 'Pong!' })
        const ping = Math.round((Date.now() - start) / 2)

        const uptimeFormatted = formatTime(process.uptime())

        const botInfo = `
> ┏━〔 𝐌𝐞𝐠𝐚𝐁𝐨𝐭-𝐌𝐃𓃵 〕━┓
> ┃ 🗿 Ping     : ${ping} ms
> ┃ ⏱️ Uptime   : ${uptimeFormatted}
> ┃ 🔖 Version  : v${settings.version}
> ┗━━━━━━━━━━━━┛`.trim()

        await sock.sendMessage(chatId, { text: botInfo }, { quoted: message })

    } catch (error) {
        console.error('Error in ping command:', error)
        await sock.sendMessage(chatId, { text: '❌ Failed to get bot status.' })
    }
}

module.exports = pingCommand;
