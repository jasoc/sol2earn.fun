/**
 * Admin Panel Server
 * Provides a web interface for managing the game server
 */

'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const config = require('../../config');

class AdminPanel {
    constructor(gameState) {
        this.app = express();
        this.server = http.Server(this.app);
        this.gameState = gameState;
        this.chatHistory = [];
        this.maxChatHistory = 500;
        this.sessions = new Map(); // sessionId -> { authenticated, isSuperAdmin, createdAt }
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../admin')));
        
        // Simple session middleware
        this.app.use((req, res, next) => {
            const sessionId = req.headers['x-session-id'];
            if (sessionId && this.sessions.has(sessionId)) {
                req.session = this.sessions.get(sessionId);
            }
            next();
        });
    }

    requireAuth(requireSuperAdmin = false) {
        return (req, res, next) => {
            if (!req.session || !req.session.authenticated) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (requireSuperAdmin && !req.session.isSuperAdmin) {
                return res.status(403).json({ error: 'Super Admin required' });
            }
            next();
        };
    }

    setupRoutes() {
        // Login
        this.app.post('/api/login', (req, res) => {
            const { password } = req.body;
            const isSuperAdmin = password === config.superAdminPass;
            const isAdmin = isSuperAdmin || password === config.adminPass;
            
            if (isAdmin) {
                const sessionId = this.generateSessionId();
                this.sessions.set(sessionId, {
                    authenticated: true,
                    isSuperAdmin,
                    createdAt: Date.now()
                });
                res.json({ 
                    success: true, 
                    sessionId, 
                    isSuperAdmin,
                    message: isSuperAdmin ? 'Welcome, Super Admin!' : 'Welcome, Admin!'
                });
            } else {
                res.status(401).json({ success: false, error: 'Invalid password' });
            }
        });

        // Logout
        this.app.post('/api/logout', (req, res) => {
            const sessionId = req.headers['x-session-id'];
            if (sessionId) {
                this.sessions.delete(sessionId);
            }
            res.json({ success: true });
        });

        // Get game stats
        this.app.get('/api/stats', this.requireAuth(), (req, res) => {
            const stats = this.getGameStats();
            res.json(stats);
        });

        // Get active players
        this.app.get('/api/players', this.requireAuth(), (req, res) => {
            const players = this.getPlayers();
            res.json(players);
        });

        // Get chat history
        this.app.get('/api/chat', this.requireAuth(), (req, res) => {
            res.json(this.chatHistory);
        });

        // Kick a player
        this.app.post('/api/kick/:playerId', this.requireAuth(), (req, res) => {
            const { playerId } = req.params;
            const { reason } = req.body;
            const result = this.kickPlayer(playerId, reason || 'Kicked by admin');
            res.json(result);
        });

        // Super Admin: Get spectate token for a player
        this.app.post('/api/spectate/:playerId', this.requireAuth(true), (req, res) => {
            const { playerId } = req.params;
            const token = this.generateSpectateToken(playerId);
            res.json({ token, playerId });
        });

        // Super Admin: Enable debug mode for self
        this.app.get('/api/debug-token', this.requireAuth(true), (req, res) => {
            const token = this.generateSessionId();
            res.json({ debugToken: token });
        });

        // Serve admin panel
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../admin/index.html'));
        });
    }

    generateSessionId() {
        return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    generateSpectateToken(playerId) {
        return 'spec_' + playerId + '_' + Date.now().toString(36);
    }

    getGameStats() {
        const players = this.gameState.players?.data || [];
        const totalMass = players.reduce((sum, p) => sum + (p.massTotal || 0), 0);
        
        return {
            playerCount: players.length,
            totalMass,
            foodCount: this.gameState.food?.data?.length || 0,
            virusCount: this.gameState.viruses?.data?.length || 0,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            gameSize: {
                width: config.gameWidth,
                height: config.gameHeight
            }
        };
    }

    getPlayers() {
        const players = this.gameState.players?.data || [];
        return players.map(p => ({
            id: p.id,
            name: p.name || 'Unnamed',
            mass: Math.round(p.massTotal || 0),
            cells: p.cells?.length || 0,
            x: Math.round(p.x || 0),
            y: Math.round(p.y || 0),
            isAdmin: p.admin || false
        }));
    }

    kickPlayer(playerId, reason) {
        if (this.gameState.kickCallback) {
            return this.gameState.kickCallback(playerId, reason);
        }
        return { success: false, error: 'Kick callback not configured' };
    }

    addChatMessage(sender, message, ip) {
        this.chatHistory.push({
            timestamp: Date.now(),
            sender,
            message,
            ip
        });
        
        // Trim history if too long
        if (this.chatHistory.length > this.maxChatHistory) {
            this.chatHistory = this.chatHistory.slice(-this.maxChatHistory);
        }
    }

    start(port) {
        this.server.listen(port, () => {
            console.log(`[ADMIN] Admin panel running on port ${port}`);
        });
    }
}

module.exports = AdminPanel;
