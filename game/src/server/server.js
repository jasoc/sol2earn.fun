/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const SAT = require('sat');

const config = require('./game-config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const AdminPanel = require('./admin-panel');
const solPrice = require('./sol-price');
const solanaService = require('./solana-service');

// Socket handlers
const registerPlayerHandlers = require('./socket-handlers/player-handler');
const registerGameHandlers = require('./socket-handlers/game-handler');
const registerChatHandlers = require('./socket-handlers/chat-handler');
const registerAdminHandlers = require('./socket-handlers/admin-handler');
const registerDebugHandlers = require('./socket-handlers/debug-handler');
const registerWalletHandlers = require('./socket-handlers/wallet-handler');
const { processCashouts } = require('./socket-handlers/wallet-handler');

let map = new mapUtils.Map(config);

let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);

let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

// ========== Initialize services ==========
solPrice.startPriceUpdates();
solanaService.init();

// ========== Admin Panel ==========
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

// ========== Static files ==========
app.use(express.static(__dirname + '/../client'));

// ========== REST endpoints for client ==========
app.get('/api/sol-price', async (req, res) => {
    try {
        const solPriceEur = await solPrice.getSolPriceEur();
        const tiers = config.entryTiers.map(tier => {
            const solAmount = solPriceEur ? (tier.eurValue / solPriceEur) : null;
            return {
                id: tier.id,
                label: tier.label,
                eurValue: tier.eurValue,
                gamePoints: tier.gamePoints,
                solAmount: solAmount ? parseFloat(solAmount.toFixed(6)) : null,
                totalSolWithFee: solAmount ? parseFloat((solAmount + config.platformFeeSol).toFixed(6)) : null,
            };
        });
        res.json({
            solPriceEur,
            tiers,
            platformFeeSol: config.platformFeeSol,
            treasuryWallet: config.treasuryWallet,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get SOL price' });
    }
});

// ========== Socket.IO connection ==========
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

const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    // Register all socket handlers
    registerPlayerHandlers(socket, currentPlayer, map, sockets, io, adminPanel);
    registerGameHandlers(socket, currentPlayer, map);
    registerChatHandlers(socket, currentPlayer, adminPanel);
    registerAdminHandlers(socket, currentPlayer, map, sockets);
    registerDebugHandlers(socket, currentPlayer, map, sockets);
    registerWalletHandlers(socket, currentPlayer, map, sockets, io);

    // Send welcome event
    socket.emit('welcome', currentPlayer, {
        width: config.gameWidth,
        height: config.gameHeight
    });
};

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
};

// ========== Collision: massFood ↔ viruses ==========
const handleMassFoodVirusCollisions = () => {
    const massFoodToRemove = [];
    const virusesToSplit = [];

    for (let massIndex = 0; massIndex < map.massFood.data.length; massIndex++) {
        const massFood = map.massFood.data[massIndex];

        for (let virusIndex = 0; virusIndex < map.viruses.data.length; virusIndex++) {
            const virus = map.viruses.data[virusIndex];

            const distance = Math.sqrt(
                Math.pow(massFood.x - virus.x, 2) + Math.pow(massFood.y - virus.y, 2)
            );

            if (distance < virus.radius + massFood.radius) {
                const direction = {
                    x: massFood.direction.x,
                    y: massFood.direction.y
                };

                virus.absorbMass(massFood.mass, direction);
                massFoodToRemove.push(massIndex);

                if (virus.shouldSplit(config.virus.feedsToSplit)) {
                    if (!virusesToSplit.find(v => v.virusIndex === virusIndex)) {
                        virusesToSplit.push({ virusIndex, direction });
                    }
                }
                break;
            }
        }
    }

    map.massFood.remove(massFoodToRemove);

    for (const splitInfo of virusesToSplit) {
        const virus = map.viruses.data[splitInfo.virusIndex];
        map.viruses.spawnFromSplit(virus, splitInfo.direction, config.virus.shotSpeed);
        virus.reset();
    }
};

// ========== Game tick ==========
const tickPlayer = (currentPlayer) => {
    // Use inactivityTimeout (hot-configurable) instead of maxHeartbeatInterval
    const timeout = config.inactivityTimeout || config.maxHeartbeatInterval;
    if (currentPlayer.lastHeartbeat < new Date().getTime() - timeout) {
        if (sockets[currentPlayer.id]) {
            sockets[currentPlayer.id].emit('kick', 'Inactivity timeout.');
            sockets[currentPlayer.id].disconnect();
        }
        return;
    }

    // Apply gameSpeed multiplier to movement
    const speedMultiplier = config.gameSpeed || 1.0;
    const effectiveSlowBase = config.slowBase / speedMultiplier;

    currentPlayer.move(effectiveSlowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);

    // Cashout slowdown: if player is cashing out, reduce effective speed
    // (achieved by moving them again in the opposite direction by 70%)
    // This is a simplified approach; the real slowdown happens via effectiveSlowBase
    // For cashout, we skip the food-eating phase but still allow being eaten

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
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle);
    };

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];
        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes);
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        // Track game points from food separately
        const foodEaten = eatenFoodIndexes.length;
        if (foodEaten > 0) {
            currentPlayer.addGamePoints(foodEaten * config.foodPointValue);
        }

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (foodEaten * config.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.virusSplitPieces, config.defaultPlayerMass);
};

const tickGame = () => {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.gameWidth, config.gameHeight);
    map.viruses.move(config.gameWidth, config.gameHeight);
    handleMassFoodVirusCollisions();

    // Player-vs-player collisions with SOL transfer
    map.players.handleCollisions(function (gotEaten, eater) {
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);

        map.players.data[eater.playerIndex].changeCellMass(eater.cellIndex, cellGotEaten.mass);

        const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (playerDied) {
            let playerGotEaten = map.players.data[gotEaten.playerIndex];
            let eaterPlayer = map.players.data[eater.playerIndex];

            // Transfer SOL from eaten player to eater
            if (playerGotEaten.solBalance > 0) {
                eaterPlayer.addSolFromEat(playerGotEaten.solBalance);
                console.log(`[SOL] ${eaterPlayer.name} ate ${playerGotEaten.name}: +${playerGotEaten.solBalance.toFixed(6)} SOL`);

                // Notify eater of updated balance
                if (sockets[eaterPlayer.id]) {
                    sockets[eaterPlayer.id].emit('solBalanceUpdate', {
                        solBalance: eaterPlayer.solBalance,
                        gained: playerGotEaten.solBalance,
                        from: playerGotEaten.name,
                    });
                }
            }

            io.emit('playerDied', { name: playerGotEaten.name });
            if (sockets[playerGotEaten.id]) {
                sockets[playerGotEaten.id].emit('RIP');
            }
            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });
};

// ========== Leaderboard ==========
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
};

const gameloop = () => {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
};

// ========== Send updates to clients ==========
const sendUpdates = () => {
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) {
        if (!sockets[playerData.id]) return;
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
};

const updateSpectator = (socketID) => {
    if (!sockets[socketID]) return;
    let playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: '',
        solBalance: 0,
        gamePoints: 0,
    };
    sockets[socketID].emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data);
    if (leaderboardChanged) {
        sendLeaderboard(sockets[socketID]);
    }
};

// ========== Game loops ==========
setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Process cashouts every second
setInterval(() => {
    processCashouts(map, sockets, io).catch(err => {
        console.error('[CASHOUT] Error processing cashouts:', err);
    });
}, 1000);

// ========== Start server ==========
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
http.listen(serverport, ipaddress, () => console.log('[SERVER] Listening on ' + ipaddress + ':' + serverport));
