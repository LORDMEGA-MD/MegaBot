const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const sharp = require('sharp')

async function setGroupIconCommand(sock, chatId, senderId, message) {
    try {
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, { text: '❌ This works in groups only.' })
        }

        const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage
        if (!quoted || !quoted.imageMessage) {
            return await sock.sendMessage(chatId, { text: '❌ Reply to an image.' })
        }

        // Download image
        const stream = await downloadContentFromMessage(quoted.imageMessage, 'image')
        let buffer = Buffer.from([])
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk])

        if (!buffer || buffer.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ Failed to download image.' })
        }

        // Detect original size
        const metadata = await sharp(buffer).metadata()
        const { width, height } = metadata

        const finalSize = 1080 // square canvas for WhatsApp

        // Resize original image to fit height OR width depending on aspect ratio
        let resizedImage
        if (height >= width) {
            // Portrait or square → scale by height
            resizedImage = await sharp(buffer)
                .resize({ height: finalSize, fit: 'contain' })
                .toBuffer()
        } else {
            // Landscape → scale by width
            resizedImage = await sharp(buffer)
                .resize({ width: finalSize, fit: 'contain' })
                .toBuffer()
        }

        // Create blurred square background
        const blurredBackground = await sharp(buffer)
            .resize(finalSize, finalSize, { fit: 'cover' })
            .blur(50)
            .toBuffer()

        // Composite original image over blurred background
        const finalBuffer = await sharp(blurredBackground)
            .composite([{ input: resizedImage, gravity: 'center' }])
            .jpeg()
            .toBuffer()

        // Upload to WhatsApp
        await sock.updateProfilePicture(chatId, finalBuffer)

        await sock.sendMessage(chatId, { text: '✅ Group icon updated with dynamic blur background!' })

    } catch (err) {
        console.error('SET ICON ERROR:', err)
        await sock.sendMessage(chatId, { text: '❌ Failed to update icon. Make sure bot is admin and image is valid.' })
    }
}

module.exports = setGroupIconCommand