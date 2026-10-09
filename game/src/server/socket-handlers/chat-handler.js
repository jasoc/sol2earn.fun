/**
 * Chat socket handlers
 */
'use strict';

const config = require('../game-config');
const chatRepository = require('../repositories/chat-repository');

module.exports = function registerChatHandlers(socket, currentPlayer, adminPanel) {

    socket.on('playerChat', (data) => {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        if (config.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }

        // Log to admin panel
        adminPanel.addChatMessage(currentPlayer.name, _message.substring(0, 35), currentPlayer.ipAddress);

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: currentPlayer.name,
            message: _message.substring(0, 35)
        });

        chatRepository.logChatMessage(_sender, _message, currentPlayer.ipAddress)
            .catch((err) => console.error("Error when attempting to log chat message", err));
    });
};
