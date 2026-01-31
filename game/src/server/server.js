/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const SAT = require('sat');

const gameLogic = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");
const AdminPanel = require('./admin-panel');

let map = new mapUtils.Map(config);

let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

// Initialize Admin Panel
const adminPanel = new AdminPanel(map);
adminPanel.gameState.kickCallback = (playerId, reason) => {
    const socket = sockets[playerId];
    if (socket) {
        socket.emit('kick', reason);
        socket.disconnect();
        map.players.removePlayerByID(playerId);
        return { success: true, message: `Player ${playerId} kicked` };
    }
    return { success: false, error: 'Player not found' };
};
adminPanel.start(config.adminPanelPort || 3001);

app.use(express.static(__dirname + '/../client'));

io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);
    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }
});

function generateSpawnpoint() {
    let radius = util.massToRadius(config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data)
}


const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    socket.on('gotit', function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');
        currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);

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

    socket.on('pass', async (data) => {
        const password = data[0];
        if (password === config.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.name + ' just logged in as an admin.');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.name);
            socket.broadcast.emit('serverMSG', currentPlayer.name + ' just logged in as an admin.');
            currentPlayer.admin = true;
        } else {
            console.log('[ADMIN] ' + currentPlayer.name + ' attempted to log in with the incorrect password: ' + password);

            socket.emit('serverMSG', 'Password incorrect, attempt logged.');

            loggingRepositry.logFailedLoginAttempt(currentPlayer.name, currentPlayer.ipAddress)
                .catch((err) => console.error("Error when attempting to log failed login attempt", err));
        }
    });

    socket.on('kick', (data) => {
        if (!currentPlayer.admin) {
            socket.emit('serverMSG', 'You are not permitted to use this command.');
            return;
        }

        var reason = '';
        var worked = false;
        for (let playerIndex in map.players.data) {
            let player = map.players.data[playerIndex];
            if (player.name === data[0] && !player.admin && !worked) {
                if (data.length > 1) {
                    for (var f = 1; f < data.length; f++) {
                        if (f === data.length) {
                            reason = reason + data[f];
                        }
                        else {
                            reason = reason + data[f] + ' ';
                        }
                    }
                }
                if (reason !== '') {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name + ' for reason ' + reason);
                }
                else {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name);
                }
                socket.emit('serverMSG', 'User ' + player.name + ' was kicked by ' + currentPlayer.name);
                sockets[player.id].emit('kick', reason);
                sockets[player.id].disconnect();
                map.players.removePlayerByIndex(playerIndex);
                worked = true;
            }
        }
        if (!worked) {
            socket.emit('serverMSG', 'Could not locate user or user is an admin.');
        }
    });

    // Heartbeat function, update everytime.
    socket.on('0', (target) => {
        currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });

    socket.on('1', function () {
        // Fire food.
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            if (currentPlayer.cells[i].mass >= minCellMass) {
                currentPlayer.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(currentPlayer, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });

    // Debug commands (only work if debugMode is enabled in config)
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
        const newVirus = new mapUtils.virusUtils.Virus({ x, y }, radius, mass, config.virus);
        map.viruses.pushNew(newVirus);
        console.log('[DEBUG] Virus spawned at ' + x + ', ' + y);
    });

    socket.on('debug:killAll', () => {
        if (!config.debugMode) return;
        // Remove all other players
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
        // Force merge all cells immediately
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
            
            // Keep only one cell with all the mass
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
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        spectators.push(socket.id);
        io.emit('playerJoin', { name: '' });
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

// Handle collisions between massFood (shot by players) and viruses
// Original agar.io behavior: virus absorbs mass, grows, and after 7 feeds splits shooting a new virus
const handleMassFoodVirusCollisions = () => {
    const massFoodToRemove = [];
    const virusesToSplit = []; // {virusIndex, direction}

    for (let massIndex = 0; massIndex < map.massFood.data.length; massIndex++) {
        const massFood = map.massFood.data[massIndex];
        
        for (let virusIndex = 0; virusIndex < map.viruses.data.length; virusIndex++) {
            const virus = map.viruses.data[virusIndex];
            
            // Check if massFood collides with virus
            const distance = Math.sqrt(
                Math.pow(massFood.x - virus.x, 2) + Math.pow(massFood.y - virus.y, 2)
            );
            
            if (distance < virus.radius + massFood.radius) {
                // Calculate direction from massFood to virus (for shooting new virus)
                const direction = {
                    x: massFood.direction.x,
                    y: massFood.direction.y
                };
                
                // Virus absorbs the massFood
                virus.absorbMass(massFood.mass, direction);
                massFoodToRemove.push(massIndex);
                
                // Check if virus should split (after 7 feeds in original agar.io)
                if (virus.shouldSplit(config.virus.feedsToSplit)) {
                    // Check if this virus isn't already marked for split
                    if (!virusesToSplit.find(v => v.virusIndex === virusIndex)) {
                        virusesToSplit.push({ 
                            virusIndex, 
                            direction: direction
                        });
                    }
                }
                break; // This massFood is consumed, move to next
            }
        }
    }

    // Remove absorbed massFood
    map.massFood.remove(massFoodToRemove);

    // Handle splitting viruses - spawn new virus in the direction of the last feed
    for (const splitInfo of virusesToSplit) {
        const virus = map.viruses.data[splitInfo.virusIndex];
        
        // Spawn a new virus shot in the direction the mass was traveling
        map.viruses.spawnFromSplit(virus, splitInfo.direction, config.virus.shotSpeed);
        
        // Reset the original virus to its base state
        virus.reset();
    }
};

const tickPlayer = (currentPlayer) => {
    if (currentPlayer.lastHeartbeat < new Date().getTime() - config.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit('kick', 'Last heartbeat received over ' + config.maxHeartbeatInterval + ' ago.');
        sockets[currentPlayer.id].disconnect();
    }

    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);

    const isEntityInsideCircle = (point, circle) => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell, cellCircle, cellIndex, mass) => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)
                return false;
            if (cell.mass > mass.mass * 1.1)
                return true;
        }

        return false;
    };

    const canEatVirus = (cell, cellCircle, virus) => {
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle)
    }

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];

        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes)
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (eatenFoodIndexes.length * config.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.virusSplitPieces, config.defaultPlayerMass);
};

const tickGame = () => {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.gameWidth, config.gameHeight);
    map.viruses.move(config.gameWidth, config.gameHeight); // Move shot viruses

    // Check collisions between massFood and viruses
    handleMassFoodVirusCollisions();

    map.players.handleCollisions(function (gotEaten, eater) {
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);

        map.players.data[eater.playerIndex].changeCellMass(eater.cellIndex, cellGotEaten.mass);

        const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (playerDied) {
            let playerGotEaten = map.players.data[gotEaten.playerIndex];
            io.emit('playerDied', { name: playerGotEaten.name }); //TODO: on client it is `playerEatenName` instead of `name`
            sockets[playerGotEaten.id].emit('RIP');
            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });

};

const calculateLeaderboard = () => {
    const topPlayers = map.players.getTopPlayers();

    if (leaderboard.length !== topPlayers.length) {
        leaderboard = topPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== topPlayers[i].id) {
                leaderboard = topPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
}

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};

const sendUpdates = () => {
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) {
        sockets[playerData.id].emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses);
        if (leaderboardChanged) {
            sendLeaderboard(sockets[playerData.id]);
        }
    });

    leaderboardChanged = false;
};

const sendLeaderboard = (socket) => {
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
}
const updateSpectator = (socketID) => {
    let playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };
    sockets[socketID].emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data);
    if (leaderboardChanged) {
        sendLeaderboard(sockets[socketID]);
    }
}

setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));
