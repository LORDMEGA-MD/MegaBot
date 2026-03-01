const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp');
const isOwnerOrSudo = require('../lib/isOwner');

async function setPpIcon(sock, chatId, msg) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command is only available for the owner!' 
            });
            return;
        }

        // Check for replied message
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMessage) {
            await sock.sendMessage(chatId, { 
                text: '⚠️ Please reply to an image with the .setpp command!' 
            });
            return;
        }

        // Check if image or sticker
        const imageMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
        if (!imageMessage) {
            await sock.sendMessage(chatId, { 
                text: '❌ The replied message must contain an image or sticker!' 
            });
            return;
        }

        // tmp directory
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        // Download image
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        if (!buffer || buffer.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ Failed to download image.' });
        }

        // Metadata
        const metadata = await sharp(buffer).metadata();
        const { width, height } = metadata;
        const finalSize = 1080;

        // Resize main image to fit height or width
        let resizedImage;
        if (height >= width) {
            resizedImage = await sharp(buffer)
                .resize({ height: finalSize, fit: 'contain' })
                .toBuffer();
        } else {
            resizedImage = await sharp(buffer)
                .resize({ width: finalSize, fit: 'contain' })
                .toBuffer();
        }

        // Blurred square background
        const blurredBackground = await sharp(buffer)
            .resize(finalSize, finalSize, { fit: 'cover' })
            .blur(50)
            .toBuffer();

        // Composite original image over blurred background
        const finalBuffer = await sharp(blurredBackground)
            .composite([{ input: resizedImage, gravity: 'center' }])
            .jpeg()
            .toBuffer();

        // Save temporary file
        const imagePath = path.join(tmpDir, `profile_${Date.now()}.jpg`);
        fs.writeFileSync(imagePath, finalBuffer);

        // Get bot JID safely
        const botJid = sock.user?.id || sock.user?.jid;
        if (!botJid) {
            fs.unlinkSync(imagePath);
            return await sock.sendMessage(chatId, { text: '❌ Bot JID not available yet!' });
        }

        // Update profile picture
        await sock.updateProfilePicture(botJid, { url: imagePath });

        // Clean up temporary file
        fs.unlinkSync(imagePath);

        await sock.sendMessage(chatId, { text: '✅ Successfully updated bot profile picture!' });

    } catch (error) {
        console.error('SET PP ERROR:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to update profile picture!' });
    }
}

module.exports = setPpIcon;