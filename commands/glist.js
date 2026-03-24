async function glistCommand(sock, chatId, message) {
  try {
    console.log('GLIST START');

    const chats = await sock.groupFetchAllParticipating();

    console.log('GROUP DATA:', chats);

    const groups = Object.values(chats);

    if (!groups.length) {
      console.log('NO GROUPS FOUND');
      return await sock.sendMessage(chatId, {
        text: '❌ Bot sees 0 groups'
      });
    }

    let text = `📋 GROUPS (${groups.length})\n\n`;

    groups.forEach((g, i) => {
      console.log(`Group ${i}:`, g.subject, g.id);

      text += `${i + 1}. ${g.subject}\n${g.id}\n\n`;
    });

    await sock.sendMessage(chatId, { text });

  } catch (err) {
    console.log('ERROR:', err);
  }
}

module.exports = glistCommand;