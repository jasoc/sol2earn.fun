/**
 * GameConfig - Reactive configuration singleton
 * Wraps the static config object with getter/setter validation
 * and allows hot-reloading from admin panel without server restart.
 */
'use strict';

const EventEmitter = require('events');
const baseConfig = require('../../config');

class GameConfig extends EventEmitter {
    constructor() {
        super();
        // Copy all base config values
        this._data = { ...baseConfig };

        // Define which keys are hot-configurable from admin panel
        // with their min/max constraints
        this._hotConfigurable = {
            gameSpeed:          { min: 0.1, max: 5.0, type: 'float' },
            foodPointValue:     { min: 1,   max: 100, type: 'int' },
            inactivityTimeout:  { min: 5000, max: 600000, type: 'int' },
            maxPlayers:         { min: 2,   max: 200, type: 'int' },
            gameWidth:          { min: 1000, max: 20000, type: 'int' },
            gameHeight:         { min: 1000, max: 20000, type: 'int' },
            cashoutCountdown:   { min: 3,   max: 30, type: 'int' },
        };
    }

    /** Get a config value */
    get(key) {
        return this._data[key];
    }

    /** Direct property access for backwards compatibility with config.xyz */
    get host()                   { return this._data.host; }
    get port()                   { return this._data.port; }
    get foodMass()               { return this._data.foodMass; }
    get fireFood()               { return this._data.fireFood; }
    get limitSplit()             { return this._data.limitSplit; }
    get defaultPlayerMass()      { return this._data.defaultPlayerMass; }
    get foodUniformDisposition() { return this._data.foodUniformDisposition; }
    get gameMass()               { return this._data.gameMass; }
    get maxFood()                { return this._data.maxFood; }
    get gameSpeed()              { return this._data.gameSpeed; }
    get foodPointValue()         { return this._data.foodPointValue; }
    get maxPlayers()             { return this._data.maxPlayers; }
    get inactivityTimeout()      { return this._data.inactivityTimeout; }
    get cashoutCountdown()       { return this._data.cashoutCountdown; }
    get virusSplitPieces()       { return this._data.virusSplitPieces; }
    get virus()                  { return this._data.virus; }
    get maxVirus()               { return this._data.maxVirus; }
    get gameWidth()              { return this._data.gameWidth; }
    get gameHeight()             { return this._data.gameHeight; }
    get slowBase()               { return this._data.slowBase; }
    get networkUpdateFactor()    { return this._data.networkUpdateFactor; }
    get massLossRate()           { return this._data.massLossRate; }
    get minMassLoss()            { return this._data.minMassLoss; }
    get entryTiers()             { return this._data.entryTiers; }
    get treasuryWallet()         { return this._data.treasuryWallet; }
    get serverPrivateKey()       { return this._data.serverPrivateKey; }
    get platformFeeSol()         { return this._data.platformFeeSol; }
    get solanaNetwork()          { return this._data.solanaNetwork; }
    get solanaRpcUrl()           { return this._data.solanaRpcUrl; }
    get adminPass()              { return this._data.adminPass; }
    get superAdminPass()         { return this._data.superAdminPass; }
    get adminPanelPort()         { return this._data.adminPanelPort; }
    get debugMode()              { return this._data.debugMode; }
    get logChat()                { return this._data.logChat; }
    get newPlayerInitialPosition() { return this._data.newPlayerInitialPosition; }
    get maxHeartbeatInterval()   { return this._data.maxHeartbeatInterval; }
    get logpath()                { return this._data.logpath; }
    get sqlinfo()                { return this._data.sqlinfo; }

    /**
     * Check if a key is hot-configurable
     */
    isHotConfigurable(key) {
        return key in this._hotConfigurable;
    }

    /**
     * Get all hot-configurable settings with current values and constraints
     */
    getHotConfigurableSettings() {
        const result = {};
        for (const [key, constraints] of Object.entries(this._hotConfigurable)) {
            result[key] = {
                value: this._data[key],
                ...constraints,
            };
        }
        return result;
    }

    /**
     * Update a hot-configurable setting. Returns { success, error, oldValue, newValue }
     */
    set(key, value) {
        if (!this.isHotConfigurable(key)) {
            return { success: false, error: `"${key}" is not hot-configurable` };
        }

        const constraints = this._hotConfigurable[key];
        let parsed;

        if (constraints.type === 'float') {
            parsed = parseFloat(value);
        } else {
            parsed = parseInt(value, 10);
        }

        if (isNaN(parsed)) {
            return { success: false, error: `Invalid number for "${key}"` };
        }

        if (parsed < constraints.min || parsed > constraints.max) {
            return { success: false, error: `"${key}" must be between ${constraints.min} and ${constraints.max}` };
        }

        const oldValue = this._data[key];
        this._data[key] = parsed;

        console.log(`[CONFIG] ${key} changed: ${oldValue} → ${parsed}`);
        this.emit('change', { key, oldValue, newValue: parsed });

        return { success: true, oldValue, newValue: parsed };
    }

    /**
     * Bulk update multiple settings. Returns results per key.
     */
    bulkSet(updates) {
        const results = {};
        for (const [key, value] of Object.entries(updates)) {
            results[key] = this.set(key, value);
        }
        return results;
    }
}

// Singleton
const instance = new GameConfig();
module.exports = instance;
