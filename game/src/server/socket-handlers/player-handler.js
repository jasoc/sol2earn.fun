/**
 * Player socket handlers - connection, respawn, disconnect, heartbeat
 */
'use strict';

const util = require('../lib/util');
const { getPosition } = require('../lib/entityUtils');
const config = require('../game-config');
const mapUtils = require('../map/map');

module.exports = function registerPlayerHandlers(socket, currentPlayer, map, sockets, io, adminPanel) {

    function generateSpawnpoint() {
        let radius = util.massToRadius(config.defaultPlayerMass);
        return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data);
    }

    socket.on('gotit', function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');

        // Check max players
        if (map.players.data.length >= config.maxPlayers) {
            socket.emit('kick', 'Server is full. Please try again later.');
            socket.disconnect();
            return;
        }

        // Use gamePoints as initial mass if set (from wallet payment), else default
        const initialMass = currentPlayer.gamePoints || config.defaultPlayerMass;
        currentPlayer.init(generateSpawnpoint(), initialMass);

        if (map.players.findIndexByID(socket.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + clientPlayerData.name + ' connected!');
            sockets[socket.id] = socket;

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;

            currentPlayer.clientProvidedData(clientPlayerData);
            map.players.pushNew(currentPlayer);
            io.emit('playerJoin', { name: currentPlayer.name });
            console.log('Total players: ' + map.players.data.length);
        }
    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', () => {
        map.players.removePlayerByID(currentPlayer.id);
        socket.emit('welcome', currentPlayer, {
            width: config.gameWidth,
            height: config.gameHeight
        });
        console.log('[INFO] User ' + currentPlayer.name + ' has respawned');
    });

    socket.on('disconnect', () => {
        map.players.removePlayerByID(currentPlayer.id);
        console.log('[INFO] User ' + currentPlayer.name + ' has disconnected');
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
    });
};
