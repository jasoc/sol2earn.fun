var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');
var PhantomWallet = require('./phantom-wallet');

var playerNameInput = document.getElementById('playerNameInput');
var socket;

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type) {
    global.playerName = playerNameInput.value.replace(/(<([^>]+)>)/ig, '').substring(0, 25);
    global.playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    document.getElementById('startMenuWrapper').style.maxHeight = '0px';
    document.getElementById('gameAreaWrapper').style.opacity = 1;
    if (!socket) {
        socket = io({ query: "type=" + type });
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;

    // Show HUD and cashout panel for paying players
    if (type === 'player' && PhantomWallet.paymentVerified) {
        document.getElementById('solHud').style.display = 'flex';
        document.getElementById('cashoutPanel').style.display = 'block';
        updateHUD();
    }
}

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var regex = /^\w*$/;
    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null;
}

window.onload = function () {

    var btnS = document.getElementById('spectateButton'),
        nickErrorText = document.querySelector('#startMenu .input-error');

    btnS.onclick = function () {
        startGame('spectator');
    };

    // ========== Wallet Connection Flow ==========
    var connectWalletBtn = document.getElementById('connectWalletBtn');
    var disconnectWalletBtn = document.getElementById('disconnectWalletBtn');
    var walletStep = document.getElementById('walletStep');
    var entryStep = document.getElementById('entryStep');
    var walletStatus = document.getElementById('walletStatus');
    var noPhantomMsg = document.getElementById('noPhantomMsg');
    var startButton = document.getElementById('startButton');
    var tierContainer = document.getElementById('tierContainer');

    // Check if Phantom is available
    if (!PhantomWallet.isPhantomInstalled()) {
        noPhantomMsg.style.display = 'block';
        connectWalletBtn.disabled = true;
        connectWalletBtn.style.opacity = '0.5';
    }

    connectWalletBtn.onclick = async function () {
        connectWalletBtn.disabled = true;
        walletStatus.textContent = 'Connecting...';
        walletStatus.className = 'wallet-status';

        var address = await PhantomWallet.connect();
        if (address) {
            walletStatus.textContent = '';
            walletStep.style.display = 'none';
            entryStep.style.display = 'block';
            document.getElementById('walletAddr').textContent =
                address.substring(0, 4) + '...' + address.substring(address.length - 4);

            // Fetch tiers
            await PhantomWallet.fetchTiers();
            tierContainer.innerHTML = PhantomWallet.buildTierHTML();
            bindTierButtons();
        } else {
            walletStatus.textContent = 'Connection failed. Please try again.';
            walletStatus.className = 'wallet-status wallet-error';
            connectWalletBtn.disabled = false;
        }
    };

    disconnectWalletBtn.onclick = async function () {
        await PhantomWallet.disconnect();
        entryStep.style.display = 'none';
        walletStep.style.display = 'block';
        connectWalletBtn.disabled = false;
        startButton.disabled = true;
        PhantomWallet.updatePaymentStatus('idle');
    };

    function bindTierButtons() {
        var tierBtns = document.querySelectorAll('.tier-btn');
        tierBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var tierId = this.getAttribute('data-tier');

                // Deselect all
                tierBtns.forEach(function (b) { b.classList.remove('selected'); });
                this.classList.add('selected');

                // Initiate payment
                if (!socket) {
                    socket = io({ query: "type=player" });
                    setupSocket(socket);
                }

                PhantomWallet.selectTierAndPay(tierId, socket,
                    function onSuccess(result) {
                        startButton.disabled = false;
                        global.solBalance = result.solBalance;
                        global.gamePoints = result.gamePoints;
                    },
                    function onError(errorMsg) {
                        window.alert('Payment error: ' + errorMsg);
                        // Re-enable tier buttons
                        tierBtns.forEach(function (b) { b.classList.remove('selected'); b.disabled = false; });
                    }
                );

                // Disable all tier buttons during payment
                tierBtns.forEach(function (b) { b.disabled = true; });
            });
        });
    }

    // Start button (enabled after payment verification)
    startButton.onclick = function () {
        if (!PhantomWallet.paymentVerified) {
            window.alert('Please complete payment first.');
            return;
        }
        if (validNick()) {
            nickErrorText.style.opacity = 0;
            startGame('player');
        } else {
            nickErrorText.style.opacity = 1;
        }
    };

    // Also support Enter key in nickname field
    playerNameInput.addEventListener('keypress', function (e) {
        var key = e.which || e.keyCode;
        if (key === global.KEY_ENTER) {
            if (PhantomWallet.paymentVerified && validNick()) {
                nickErrorText.style.opacity = 0;
                startGame('player');
            } else if (!validNick()) {
                nickErrorText.style.opacity = 1;
            }
        }
    });

    var settingsMenu = document.getElementById('settingsButton');
    var settings = document.getElementById('settings');

    settingsMenu.onclick = function () {
        if (settings.style.maxHeight == '300px') {
            settings.style.maxHeight = '0px';
        } else {
            settings.style.maxHeight = '300px';
        }
    };

    // ========== Cashout Button ==========
    document.getElementById('cashoutBtn').addEventListener('click', function () {
        if (socket && global.gameStart) {
            socket.emit('cashout');
        }
    });
};

// TODO: Break out into GameControls.

var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

var player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var users = [];
var leaderboard = [];
var target = { x: player.x, y: player.y };
global.target = target;

// SOL tracking
global.solBalance = 0;
global.gamePoints = 0;
global.walletAddress = null;
global.cashingOut = false;
global.cashoutSecondsLeft = 0;

window.canvas = new Canvas();
window.chat = new ChatClient();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = settings.toggleBorder;

var showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = settings.toggleMass;

var continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = settings.toggleContinuity;

var roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = settings.toggleRoundFood;

var c = window.canvas.cv;
var graph = c.getContext('2d');

document.getElementById("feed").addEventListener("click", function () {
    socket.emit('1');
    window.canvas.reenviar = false;
});

document.getElementById("split").addEventListener("click", function () {
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect() {
    socket.close();
    if (!global.kicked) { // We have a more specific error message 
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

// socket stuff.
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    // Handle debug config response
    socket.on('debug:config', function (config) {
        global.debugMode = config.debugMode;
        if (global.debugMode) {
            window.chat.addSystemLine('[DEBUG] Debug mode is enabled. Press F1 for debug menu.');
        }
    });

    // Handle error.
    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    // Handle connection.
    socket.on('welcome', function (playerSettings, gameSizes) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        global.player = player;
        window.chat.player = player;
        socket.emit('gotit', player);
        global.gameStart = true;
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
        // Request debug config from server
        socket.emit('debug:getConfig');
    });

    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            var solInfo = leaderboard[i].solBalance ? ' ◎' + leaderboard[i].solBalance.toFixed(3) : '';
            if (leaderboard[i].id == player.id) {
                if (leaderboard[i].name.length !== 0)
                    status += '<span class="me">' + (i + 1) + '. ' + leaderboard[i].name + solInfo + "</span>";
                else
                    status += '<span class="me">' + (i + 1) + ". An unnamed cell" + solInfo + "</span>";
            } else {
                if (leaderboard[i].name.length !== 0)
                    status += (i + 1) + '. ' + leaderboard[i].name + solInfo;
                else
                    status += (i + 1) + '. An unnamed cell' + solInfo;
            }
        }
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    // Chat.
    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    // Handle movement.
    socket.on('serverTellPlayerMove', function (playerData, userData, foodsList, massList, virusList) {
        if (global.playerType == 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            player.cells = playerData.cells;
            // Update SOL tracking from server
            if (typeof playerData.solBalance !== 'undefined') {
                global.solBalance = playerData.solBalance;
            }
            if (typeof playerData.gamePoints !== 'undefined') {
                global.gamePoints = playerData.gamePoints;
            }
            if (typeof playerData.isCashingOut !== 'undefined') {
                global.cashingOut = playerData.isCashingOut;
            }
            updateHUD();
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
    });

    // ========== SOL Balance Events ==========
    socket.on('solBalanceUpdate', function (data) {
        global.solBalance = data.solBalance;
        updateHUD();
        if (data.from) {
            window.chat.addSystemLine('💰 You ate <b>' + data.from + '</b> and gained <b>' + data.gained.toFixed(4) + ' SOL</b>!');
        }
    });

    // ========== Cashout Events ==========
    socket.on('cashoutStarted', function (data) {
        global.cashingOut = true;
        global.cashoutSecondsLeft = data.countdown;
        document.getElementById('cashoutBtn').style.display = 'none';
        document.getElementById('cashoutCountdown').style.display = 'block';
        startCashoutCountdown(data.countdown);
    });

    socket.on('cashoutComplete', function (data) {
        global.cashingOut = false;
        global.gameStart = false;
        render.drawErrorMessage('Cashed out ' + data.amount.toFixed(4) + ' SOL! TX: ' + data.txSignature.substring(0, 8) + '...', graph, global.screen);
        window.setTimeout(function () {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            document.getElementById('solHud').style.display = 'none';
            document.getElementById('cashoutPanel').style.display = 'none';
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 3000);
    });

    socket.on('cashoutResult', function (data) {
        if (!data.success) {
            global.cashingOut = false;
            document.getElementById('cashoutBtn').style.display = 'block';
            document.getElementById('cashoutCountdown').style.display = 'none';
            window.chat.addSystemLine('❌ Cashout failed: ' + data.error);
        }
    });

    socket.on('cashoutExit', function () {
        // Server disconnected us after cashout
    });

    // Death.
    socket.on('RIP', function () {
        global.gameStart = false;
        global.cashingOut = false;
        var deathMsg = 'You died!';
        if (global.solBalance > 0) {
            deathMsg += ' Lost ' + global.solBalance.toFixed(4) + ' SOL';
        }
        global.solBalance = 0;
        global.gamePoints = 0;
        render.drawErrorMessage(deathMsg, graph, global.screen);
        window.setTimeout(() => {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            document.getElementById('solHud').style.display = 'none';
            document.getElementById('cashoutPanel').style.display = 'none';
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });

    socket.on('kick', function (reason) {
        global.gameStart = false;
        global.kicked = true;
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        }
        else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });

    // ========== Window Blur → Auto-Cashout ==========
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && global.gameStart && global.solBalance > 0) {
            socket.emit('windowBlur');
        }
    });

    window.addEventListener('blur', function () {
        if (global.gameStart && global.solBalance > 0) {
            socket.emit('windowBlur');
        }
    });
}

const isUnnamedCell = (name) => name.length < 1;

// ========== HUD + Cashout Helpers ==========

function updateHUD() {
    var solEl = document.getElementById('hudSolBalance');
    var ptsEl = document.getElementById('hudGamePoints');
    if (solEl) solEl.textContent = (global.solBalance || 0).toFixed(4);
    if (ptsEl) ptsEl.textContent = Math.round(global.gamePoints || 0);
}

var cashoutInterval = null;
function startCashoutCountdown(seconds) {
    var remaining = seconds;
    var timerEl = document.getElementById('cashoutTimer');
    if (timerEl) timerEl.textContent = remaining;
    if (cashoutInterval) clearInterval(cashoutInterval);
    cashoutInterval = setInterval(function () {
        remaining--;
        if (timerEl) timerEl.textContent = Math.max(0, remaining);
        if (remaining <= 0) {
            clearInterval(cashoutInterval);
            cashoutInterval = null;
        }
    }, 1000);
}

const getPosition = (entity, player, screen) => {
    return {
        x: entity.x - player.x + screen.width / 2,
        y: entity.y - player.y + screen.height / 2
    }
}

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function (handle) {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);
        foods.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });
        fireFood.forEach(fireFood => {
            let position = getPosition(fireFood, player, global.screen);
            render.drawFireFood(position, fireFood, playerConfig, graph);
        });
        let borders = { // Position of the borders on the screen
            left: global.screen.width / 2 - player.x,
            right: global.screen.width / 2 + global.game.width - player.x,
            top: global.screen.height / 2 - player.y,
            bottom: global.screen.height / 2 + global.game.height - player.y
        }
        if (global.borderDraw) {
            render.drawBorder(borders, graph);
        }

        var cellsToDraw = [];
        for (var i = 0; i < users.length; i++) {
            let color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            let solBalance = users[i].solBalance || 0;
            let isCashingOut = users[i].isCashingOut || false;
            for (var j = 0; j < users[i].cells.length; j++) {
                cellsToDraw.push({
                    color: color,
                    borderColor: borderColor,
                    mass: users[i].cells[j].mass,
                    name: users[i].name,
                    radius: users[i].cells[j].radius,
                    x: users[i].cells[j].x - player.x + global.screen.width / 2,
                    y: users[i].cells[j].y - player.y + global.screen.height / 2,
                    solBalance: solBalance,
                    isCashingOut: isCashingOut,
                });
            }
        }
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        // Draw viruses after cells so players can hide underneath them
        viruses.forEach(virus => {
            let position = getPosition(virus, player, global.screen);
            render.drawVirus(position, virus, graph);
        });

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

window.addEventListener('resize', resize);

function resize() {
    if (!socket) return;

    player.screenWidth = c.width = global.screen.width = global.playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType == 'player' ? window.innerHeight : global.game.height;

    if (global.playerType == 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
    }

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}

// ==================== DEBUG MENU ====================

function toggleDebugMenu() {
    if (!global.debugMode) {
        window.chat.addSystemLine('[DEBUG] Debug mode is not enabled on server.');
        return;
    }
    
    var debugMenu = document.getElementById('debugMenu');
    global.debugMenuVisible = !global.debugMenuVisible;
    debugMenu.style.display = global.debugMenuVisible ? 'block' : 'none';
}

function updateDebugInfo() {
    if (!global.debugMenuVisible || !global.player) return;
    
    document.getElementById('debugPosX').textContent = Math.round(global.player.x || 0);
    document.getElementById('debugPosY').textContent = Math.round(global.player.y || 0);
    document.getElementById('debugMassTotal').textContent = Math.round(global.player.massTotal || 0);
    document.getElementById('debugCellCount').textContent = global.player.cells ? global.player.cells.length : 0;
}

// Update debug info every frame
setInterval(updateDebugInfo, 100);

// Debug keyboard handler
document.addEventListener('keydown', function(e) {
    if (e.keyCode === global.KEY_F1) {
        e.preventDefault();
        toggleDebugMenu();
    }
});

// Setup debug menu buttons when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Mass controls
    document.getElementById('debugAddMass100')?.addEventListener('click', function() {
        if (socket) socket.emit('debug:addMass', 100);
    });
    
    document.getElementById('debugAddMass500')?.addEventListener('click', function() {
        if (socket) socket.emit('debug:addMass', 500);
    });
    
    document.getElementById('debugAddMass1000')?.addEventListener('click', function() {
        if (socket) socket.emit('debug:addMass', 1000);
    });
    
    document.getElementById('debugSetMass')?.addEventListener('click', function() {
        var mass = prompt('Enter mass value (10-50000):', '1000');
        if (mass && socket) {
            socket.emit('debug:setMass', parseInt(mass));
        }
    });
    
    // Teleport controls
    document.getElementById('debugTeleportCenter')?.addEventListener('click', function() {
        if (socket) socket.emit('debug:teleportToCenter');
    });
    
    document.getElementById('debugTeleportRandom')?.addEventListener('click', function() {
        if (socket) {
            var x = Math.random() * global.game.width;
            var y = Math.random() * global.game.height;
            socket.emit('debug:teleport', { x: x, y: y });
        }
    });
    
    document.getElementById('debugTeleportCustom')?.addEventListener('click', function() {
        var x = prompt('Enter X coordinate:', Math.round(global.player?.x || 0));
        var y = prompt('Enter Y coordinate:', Math.round(global.player?.y || 0));
        if (x && y && socket) {
            socket.emit('debug:teleport', { x: parseInt(x), y: parseInt(y) });
        }
    });
    
    // Action controls
    document.getElementById('debugMerge')?.addEventListener('click', function() {
        if (socket) socket.emit('debug:merge');
    });
    
    document.getElementById('debugSpawnVirus')?.addEventListener('click', function() {
        if (socket && global.player) {
            // Spawn virus in front of player
            socket.emit('debug:spawnVirus', {
                x: global.player.x + 200,
                y: global.player.y
            });
        }
    });
    
    document.getElementById('debugKillAll')?.addEventListener('click', function() {
        if (confirm('Kill all other players?')) {
            if (socket) socket.emit('debug:killAll');
        }
    });
});
