module.exports = {
    host: "0.0.0.0",
    port: 3000,
    logpath: "logger.php",
    foodMass: 1,
    fireFood: 20,
    limitSplit: 16,
    defaultPlayerMass: 10,
    // Debug mode - enables debug menu with cheats (press F1 to toggle)
    debugMode: true,
    // Virus split configuration - how many pieces player splits into when eating a virus
    virusSplitPieces: 8,  // Max pieces when hitting a virus (original agar.io uses ~16)
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
        feedsToSplit: 7,        // Number of mass feeds needed to split the virus
        shotSpeed: 25,          // Speed of the virus when shot
	},
    gameWidth: 5000,
    gameHeight: 5000,
    // Admin panel configuration
    adminPass: "DEFAULT",
    superAdminPass: process.env.SUPER_ADMIN_PASS || "superadmin123",
    adminPanelPort: 3001,
    gameMass: 20000,
    maxFood: 1000,
    maxVirus: 50,
    slowBase: 4.5,
    logChat: 1,  // Enable chat logging for admin panel
    networkUpdateFactor: 40,
    maxHeartbeatInterval: 5000,
    foodUniformDisposition: true,
    newPlayerInitialPosition: "farthest",
    massLossRate: 1,
    minMassLoss: 50,
    sqlinfo: {
      fileName: "db.sqlite3",
    }
};
