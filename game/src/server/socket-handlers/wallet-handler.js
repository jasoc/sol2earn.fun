/**
 * Wallet socket handlers - payment verification, cash-out, SOL price
 */
'use strict';

const config = require('../game-config');
const solanaService = require('../solana-service');
const solPrice = require('../sol-price');

module.exports = function registerWalletHandlers(socket, currentPlayer, map, sockets, io) {

    /**
     * Client requests current SOL price + tier info
     * Response: { solPriceEur, tiers: [{ id, label, eurValue, gamePoints, solAmount, totalSolWithFee }], platformFeeSol }
     */
    socket.on('getSolPrice', async () => {
        try {
            const solPriceEur = await solPrice.getSolPriceEur();
            const tiers = [];

            for (const tier of config.entryTiers) {
                const solAmount = solPriceEur ? (tier.eurValue / solPriceEur) : null;
                tiers.push({
                    id: tier.id,
                    label: tier.label,
                    eurValue: tier.eurValue,
                    gamePoints: tier.gamePoints,
                    solAmount: solAmount ? parseFloat(solAmount.toFixed(6)) : null,
                    totalSolWithFee: solAmount ? parseFloat((solAmount + config.platformFeeSol).toFixed(6)) : null,
                });
            }

            socket.emit('solPriceData', {
                solPriceEur,
                tiers,
                platformFeeSol: config.platformFeeSol,
                treasuryWallet: config.treasuryWallet,
            });
        } catch (err) {
            console.error('[WALLET] Error fetching SOL price:', err);
            socket.emit('solPriceData', { error: 'Failed to fetch SOL price' });
        }
    });

    /**
     * Client sends payment verification after Phantom transaction
     * Payload: { txSignature, walletAddress, tierId }
     */
    socket.on('verifyPayment', async (data) => {
        try {
            const { txSignature, walletAddress, tierId } = data;

            if (!txSignature || !walletAddress || !tierId) {
                socket.emit('paymentResult', { success: false, error: 'Missing payment data' });
                return;
            }

            // Find the tier
            const tier = config.entryTiers.find(t => t.id === tierId);
            if (!tier) {
                socket.emit('paymentResult', { success: false, error: 'Invalid tier' });
                return;
            }

            // Calculate expected amounts
            const solPriceEur = await solPrice.getSolPriceEur();
            if (!solPriceEur) {
                socket.emit('paymentResult', { success: false, error: 'SOL price unavailable' });
                return;
            }

            const entryFeeSol = tier.eurValue / solPriceEur;
            const totalExpectedSol = entryFeeSol + config.platformFeeSol;

            // Verify the transaction on-chain
            const verification = await solanaService.verifyPayment(txSignature, totalExpectedSol, walletAddress);

            if (!verification.valid) {
                socket.emit('paymentResult', { success: false, error: verification.error });
                return;
            }

            // Payment verified! Initialize the player's wallet data
            currentPlayer.initWallet(
                walletAddress,
                parseFloat(entryFeeSol.toFixed(9)),  // SOL balance = entry fee (excl. platform fee)
                tier.gamePoints,
                tierId
            );

            console.log(`[WALLET] Payment verified for ${currentPlayer.name}: ${entryFeeSol.toFixed(6)} SOL (tier: ${tierId}), tx: ${txSignature}`);

            socket.emit('paymentResult', {
                success: true,
                solBalance: currentPlayer.solBalance,
                gamePoints: currentPlayer.gamePoints,
                walletAddress: currentPlayer.walletAddress,
            });

        } catch (err) {
            console.error('[WALLET] verifyPayment error:', err);
            socket.emit('paymentResult', { success: false, error: 'Server error during verification' });
        }
    });

    /**
     * Player initiates cash-out
     */
    socket.on('cashout', () => {
        if (!currentPlayer.walletAddress) {
            socket.emit('cashoutResult', { success: false, error: 'No wallet connected' });
            return;
        }

        if (currentPlayer.solBalance <= 0) {
            socket.emit('cashoutResult', { success: false, error: 'No SOL to cash out' });
            return;
        }

        if (currentPlayer.isCashingOut) {
            socket.emit('cashoutResult', { success: false, error: 'Already cashing out' });
            return;
        }

        const started = currentPlayer.startCashout();
        if (started) {
            socket.emit('cashoutStarted', {
                countdown: config.cashoutCountdown,
                solBalance: currentPlayer.solBalance,
            });
            console.log(`[WALLET] ${currentPlayer.name} started cash-out (${currentPlayer.solBalance} SOL, ${config.cashoutCountdown}s countdown)`);
        }
    });

    /**
     * Visibility change / window blur - trigger cashout
     */
    socket.on('windowBlur', () => {
        if (currentPlayer.walletAddress && currentPlayer.solBalance > 0 && !currentPlayer.isCashingOut) {
            const started = currentPlayer.startCashout();
            if (started) {
                socket.emit('cashoutStarted', {
                    countdown: config.cashoutCountdown,
                    solBalance: currentPlayer.solBalance,
                });
                console.log(`[WALLET] ${currentPlayer.name} auto-cashout triggered (window blur)`);
            }
        }
    });
};

/**
 * Process completed cash-outs. Called from game tick.
 * Returns array of { playerId, amount, walletAddress } for players whose cashout completed.
 */
module.exports.processCashouts = async function processCashouts(map, sockets, io) {
    const completedCashouts = [];

    for (let i = map.players.data.length - 1; i >= 0; i--) {
        const player = map.players.data[i];
        if (!player.isCashingOut) continue;

        if (player.isCashoutReady(config.cashoutCountdown)) {
            const amount = player.solBalance;
            const walletAddress = player.walletAddress;

            // Send payout
            if (amount > 0 && walletAddress) {
                const result = await solanaService.sendPayout(walletAddress, amount);
                if (result.success) {
                    console.log(`[WALLET] Cash-out complete: ${amount} SOL to ${walletAddress} (tx: ${result.txSignature})`);
                    if (sockets[player.id]) {
                        sockets[player.id].emit('cashoutComplete', {
                            amount,
                            txSignature: result.txSignature,
                        });
                    }
                } else {
                    console.error(`[WALLET] Cash-out failed for ${player.name}: ${result.error}`);
                    if (sockets[player.id]) {
                        sockets[player.id].emit('cashoutResult', {
                            success: false,
                            error: 'Payout failed: ' + result.error,
                        });
                    }
                    player.cancelCashout();
                    continue; // Don't remove player if payout fails
                }
            }

            // Remove player from game
            if (sockets[player.id]) {
                sockets[player.id].emit('cashoutExit');
                sockets[player.id].disconnect();
            }
            map.players.removePlayerByIndex(i);
            completedCashouts.push({ playerId: player.id, amount, walletAddress });
        }
    }

    return completedCashouts;
};
