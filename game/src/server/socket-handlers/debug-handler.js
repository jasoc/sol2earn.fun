/**
 * Debug socket handlers - all debug:* events
 */
'use strict';

const config = require('../game-config');
const util = require('../lib/util');
const mapUtils = require('../map/map');

module.exports = function registerDebugHandlers(socket, currentPlayer, map, sockets) {

    socket.on('debug:addMass', (amount) => {
        if (!config.debugMode) return;
        const massToAdd = Math.min(Math.max(amount || 100, 1), 10000);
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            currentPlayer.changeCellMass(i, massToAdd);
        }
        console.log('[DEBUG] Player ' + currentPlayer.name + ' added ' + massToAdd + ' mass');
    });

    socket.on('debug:teleport', (position) => {
        if (!config.debugMode) return;
        const x = Math.min(Math.max(position.x || 0, 0), config.gameWidth);
        const y = Math.min(Math.max(position.y || 0, 0), config.gameHeight);
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            currentPlayer.cells[i].x = x;
            currentPlayer.cells[i].y = y;
        }
        console.log('[DEBUG] Player ' + currentPlayer.name + ' teleported to ' + x + ', ' + y);
    });

    socket.on('debug:teleportToCenter', () => {
        if (!config.debugMode) return;
        const x = config.gameWidth / 2;
        const y = config.gameHeight / 2;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            currentPlayer.cells[i].x = x;
            currentPlayer.cells[i].y = y;
        }
        console.log('[DEBUG] Player ' + currentPlayer.name + ' teleported to center');
    });

    socket.on('debug:setMass', (mass) => {
        if (!config.debugMode) return;
        const newMass = Math.min(Math.max(mass || 100, 10), 50000);
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            currentPlayer.cells[i].mass = newMass;
            currentPlayer.cells[i].radius = util.massToRadius(newMass);
        }
        console.log('[DEBUG] Player ' + currentPlayer.name + ' mass set to ' + newMass);
    });

    socket.on('debug:spawnVirus', (position) => {
        if (!config.debugMode) return;
        const x = position?.x || currentPlayer.x + 200;
        const y = position?.y || currentPlayer.y;
        const mass = util.randomInRange(config.virus.defaultMass.from, config.virus.defaultMass.to);
        const radius = util.massToRadius(mass);
        const virusUtils = require('../map/virus');
        const newVirus = new virusUtils.Virus({ x, y }, radius, mass, config.virus);
        map.viruses.pushNew(newVirus);
        console.log('[DEBUG] Virus spawned at ' + x + ', ' + y);
    });

    socket.on('debug:killAll', () => {
        if (!config.debugMode) return;
        for (let i = map.players.data.length - 1; i >= 0; i--) {
            if (map.players.data[i].id !== currentPlayer.id) {
                const playerToKill = map.players.data[i];
                if (sockets[playerToKill.id]) {
                    sockets[playerToKill.id].emit('RIP');
                }
                map.players.removePlayerByIndex(i);
            }
        }
        console.log('[DEBUG] All other players killed by ' + currentPlayer.name);
    });

    socket.on('debug:merge', () => {
        if (!config.debugMode) return;
        if (currentPlayer.cells.length > 1) {
            let totalMass = 0;
            let avgX = 0, avgY = 0;
            for (let cell of currentPlayer.cells) {
                totalMass += cell.mass;
                avgX += cell.x;
                avgY += cell.y;
            }
            avgX /= currentPlayer.cells.length;
            avgY /= currentPlayer.cells.length;

            currentPlayer.cells = [currentPlayer.cells[0]];
            currentPlayer.cells[0].mass = totalMass;
            currentPlayer.cells[0].radius = util.massToRadius(totalMass);
            currentPlayer.cells[0].x = avgX;
            currentPlayer.cells[0].y = avgY;
        }
        console.log('[DEBUG] Player ' + currentPlayer.name + ' merged all cells');
    });

    socket.on('debug:getConfig', () => {
        if (!config.debugMode) return;
        socket.emit('debug:config', {
            debugMode: config.debugMode,
            gameWidth: config.gameWidth,
            gameHeight: config.gameHeight
        });
    });
};
