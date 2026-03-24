const chalk = require('chalk')

// ==================== HELPERS ====================
function getTime() {
    const now = new Date()
    const day = now.toLocaleDateString('en-US', { weekday: 'long' })
    const time = now.toLocaleTimeString('en-GB', { hour12: false })
    return `${day}, ${time} EAT`
}

function cleanText(text = '') {
    return text.replace(/\n/g, ' ')
}

function line(len = 60) {
    return '─'.repeat(len)
}

function center(text, width = 60) {
    const pad = Math.max(0, Math.floor((width - text.length) / 2))
    return ' '.repeat(pad) + text
}

function getMessageText(m) {
    return (
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        m.message?.documentMessage?.caption ||
        (m.message?.imageMessage && '[📷 Image]') ||
        (m.message?.videoMessage && '[🎥 Video]') ||
        (m.message?.audioMessage && '[🎧 Audio]') ||
        (m.message?.stickerMessage && '[🧩 Sticker]') ||
        '[Unknown]'
    )
}

// ==================== COLOR PALETTE ====================
const palette = [
    '#FF1493', // hot pink
    '#00FF7F', // spring green
    '#FFD700', // gold
    '#00BFFF', // deep sky blue
    '#FF00FF', // magenta
    '#32CD32'  // lime
]
let logColorIndex = 0

// ==================== MAIN LOGGER ====================
async function logMessage(sock, m) {
    try {
        const isGroup = m.key.remoteJid.endsWith('@g.us')
        const fromMe = m.key.fromMe

        const senderJid = m.key.participant || m.key.remoteJid
        const senderNumber = senderJid.replace(/[^0-9]/g, '')

        // Get sender name
        let senderName = senderNumber
        try {
            senderName = await sock.getName(senderJid)
        } catch {}

        // Get group name
        let groupName = 'Private Chat'
        if (isGroup) {
            try {
                const meta = await sock.groupMetadata(m.key.remoteJid)
                groupName = meta.subject || 'Unknown Group'
            } catch {
                groupName = 'Group'
            }
        }

        const time = getTime()
        const text = cleanText(getMessageText(m))
        const direction = fromMe ? '⬆️ OUTGOING' : '⬇️ INCOMING'
        const messageType = Object.keys(m.message || {})[0] || 'protocolMessage'

        // Cycle accent color
        const accentHex = palette[logColorIndex % palette.length]
        logColorIndex++
        const box = chalk.hex(accentHex)

        // Colors
        const labelColor = chalk.yellowBright
        const nameColor = chalk.cyanBright
        const chatColor = chalk.hex('#FF1493')
        const groupColor = chalk.magentaBright
        const timeColor = chalk.hex('#00BFFF')
        const typeColor = chalk.greenBright
        const msgColor = chalk.whiteBright
        const dirColor = fromMe ? chalk.blueBright : chalk.greenBright

        console.log('') // spacing

        // Top border
        console.log(box(`┌${line()}┐`))

        // Title
        console.log(box(`│${center(chalk.bold.whiteBright('💬 MEGA BOT'), 60)}`))

        console.log(box(`├${line()}┤`))

        // Direction
        console.log(box(`│ ${dirColor(direction)}${' '.repeat(Math.max(0, 60 - direction.length - 2))}`))

        // Sender
        console.log(box(`│ 👤 ${labelColor('Sender:')} ${nameColor(senderName)} ${chalk.gray(`(${senderNumber})`)}${' '.repeat(Math.max(0, 60 - senderName.length - senderNumber.length - 14))}`))

        // Chat ID / Number line
        console.log(box(`│ ${labelColor('Chat ID:')} ${chatColor(isGroup ? groupName : senderNumber)}${' '.repeat(Math.max(0, 60 - (isGroup ? groupName.length : senderNumber.length) - 10))}`))

        // Group
        console.log(box(`│ ${labelColor('Group:')} ${groupColor(groupName)}${' '.repeat(Math.max(0, 60 - groupName.length - 8))}`))

        // Time
        console.log(box(`│ ${labelColor('Time:')} ${timeColor(time)}${' '.repeat(Math.max(0, 60 - time.length - 7))}`))

        // Type
        console.log(box(`│ ${labelColor('Type:')} ${typeColor(messageType)}${' '.repeat(Math.max(0, 60 - messageType.length - 7))}`))

        console.log(box(`├${line()}┤`))

        // Message text (split long lines)
        const msgLines = text.match(/.{1,58}/g) || [text]
        for (const lineText of msgLines) {
            console.log(box(`│ ${labelColor('Message:')} ${msgColor(lineText)}${' '.repeat(Math.max(0, 60 - lineText.length - 10))}`))
        }

        // Bottom border
        console.log(box(`└${line()}┘\n`))

    } catch (err) {
        console.error('Logger error:', err)
    }
}

module.exports = { logMessage }