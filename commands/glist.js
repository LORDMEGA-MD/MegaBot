async function glistCommand(sock, chatId, message, userMessage) {
  try {
    // .gjid — only print the bare JID, nothing else
    if (userMessage && userMessage.trim() === '.gjid') {
      if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: 'Use this command inside a group.' }, { quoted: message });
      }
      return await sock.sendMessage(chatId, { text: chatId }, { quoted: message });
    }

    // .glist — list all groups with their JIDs
    const chats = await sock.groupFetchAllParticipating();
    const groups = Object.values(chats);

    if (!groups.length) {
      return await sock.sendMessage(chatId, { text: '❌ Bot is not in any groups.' }, { quoted: message });
    }

    let text = `_📋 *GROUPS (${groups.length})*_\n\n`;
    groups.forEach((g, i) => {
      const memberCount = g.participants ? g.participants.length : 0;
      text += `> ${i + 1}. *${g.subject}*\n> 🆔 ${g.id}\n> 👥 ${memberCount} members\n\n`;
    });

    await sock.sendMessage(chatId, { text: text.trim() }, { quoted: message });

  } catch (err) {
    console.error('[GLIST ERROR]', err);
    await sock.sendMessage(chatId, { text: '❌ Failed to fetch groups.' }, { quoted: message });
  }
}

module.exports = glistCommand;
