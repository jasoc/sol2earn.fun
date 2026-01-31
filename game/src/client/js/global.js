module.exports = {
    // Keys and other mathematical constants
    KEY_ESC: 27,
    KEY_ENTER: 13,
    KEY_CHAT: 13,
    KEY_FIREFOOD: 87,  // W key (uppercase keycode for keydown)
    KEY_FIREFOOD_LOWER: 119, // w key (lowercase for keypress)
    KEY_SPLIT: 32,
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    KEY_F1: 112, // Debug menu toggle
    borderDraw: false,
    mobile: false,
    // Debug mode
    debugMode: false,
    debugMenuVisible: false,
    // Canvas
    screen: {
        width: window.innerWidth,
        height: window.innerHeight
    },
    game: {
        width: 0,
        height: 0
    },
    gameStart: false,
    disconnected: false,
    kicked: false,
    continuity: false,
    startPingTime: 0,
    toggleMassState: 0,
    backgroundColor: '#0a0a1a',
    lineColor: '#1a1a3a',
};
