require('dotenv').config();

module.exports = {
    host: "0.0.0.0",
    port: 3000,
    logpath: "logger.php",

    // ========== Food & Mass ==========
    foodMass: 1,
    fireFood: 20,
    limitSplit: 16,
    defaultPlayerMass: 10,
    foodUniformDisposition: true,
    gameMass: 20000,
    maxFood: 1000,

    // ========== Gameplay (hot-configurable from admin) ==========
    gameSpeed: 1.0,               // Global speed multiplier (0.5 – 3.0)
    foodPointValue: 2,            // Game-points per food eaten
    maxPlayers: 50,               // Max concurrent players
    inactivityTimeout: 60000,     // ms before kicking idle player
    cashoutCountdown: 6,          // Seconds for cash-out countdown

    // ========== Virus ==========
    virusSplitPieces: 8,
    virus: {
        fill: "#33ff33",
        stroke: "#19D119",
        strokeWidth: 20,
        defaultMass: {
            from: 100,
            to: 150
        },
        splitMass: 180,
        uniformDisposition: false,
        feedsToSplit: 7,
        shotSpeed: 25,
    },
    maxVirus: 50,

    // ========== World ==========
    gameWidth: 5000,
    gameHeight: 5000,

    // ========== Physics ==========
    slowBase: 4.5,
    networkUpdateFactor: 40,
    massLossRate: 1,
    minMassLoss: 50,

    // ========== Entry Tiers ==========
    entryTiers: [
        { id: 'tier1', label: '€0.50', eurValue: 0.50, gamePoints: 50 },
        { id: 'tier2', label: '€1.00', eurValue: 1.00, gamePoints: 100 },
    ],

    // ========== Solana / Wallet ==========
    treasuryWallet: process.env.TREASURY_WALLET || '',
    serverPrivateKey: process.env.SERVER_PRIVATE_KEY || '',
    platformFeeSol: parseFloat(process.env.PLATFORM_FEE_SOL) || 0.0008,
    solanaNetwork: process.env.SOLANA_NETWORK || 'mainnet-beta',
    solanaRpcUrl: process.env.SOLANA_RPC_URL || '',

    // ========== Admin ==========
    adminPass: process.env.ADMIN_PASS || "DEFAULT",
    superAdminPass: process.env.SUPER_ADMIN_PASS || "superadmin123",
    adminPanelPort: 3001,

    // ========== Debug ==========
    debugMode: process.env.DEBUG_MODE === 'true',

    // ========== Misc ==========
    logChat: 1,
    newPlayerInitialPosition: "farthest",
    maxHeartbeatInterval: 5000,
    sqlinfo: {
        fileName: "db.sqlite3",
    }
};
