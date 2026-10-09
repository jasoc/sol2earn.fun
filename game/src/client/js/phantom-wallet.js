/**
 * Phantom Wallet integration for Sol2Earn.fun
 * Handles wallet connection, tier selection, payment, and cashout UI state.
 * Uses window.phantom.solana (vanilla JS, no React hooks).
 */
'use strict';

var global = require('./global');

var PhantomWallet = {
    provider: null,
    publicKey: null,
    connected: false,
    tiers: [],
    selectedTier: null,
    solPriceEur: null,
    paymentVerified: false,

    /**
     * Check if Phantom is available
     */
    isPhantomInstalled: function () {
        return !!(window.phantom && window.phantom.solana && window.phantom.solana.isPhantom);
    },

    /**
     * Get the Phantom provider
     */
    getProvider: function () {
        if (this.isPhantomInstalled()) {
            this.provider = window.phantom.solana;
            return this.provider;
        }
        return null;
    },

    /**
     * Connect to Phantom wallet
     * @returns {Promise<string|null>} wallet address or null
     */
    connect: async function () {
        try {
            var provider = this.getProvider();
            if (!provider) {
                console.error('[PHANTOM] Phantom wallet not found');
                return null;
            }

            var resp = await provider.connect();
            this.publicKey = resp.publicKey.toString();
            this.connected = true;
            console.log('[PHANTOM] Connected:', this.publicKey);
            return this.publicKey;
        } catch (err) {
            console.error('[PHANTOM] Connection failed:', err);
            this.connected = false;
            return null;
        }
    },

    /**
     * Disconnect wallet
     */
    disconnect: async function () {
        try {
            if (this.provider) {
                await this.provider.disconnect();
            }
        } catch (err) {
            console.error('[PHANTOM] Disconnect error:', err);
        }
        this.publicKey = null;
        this.connected = false;
        this.paymentVerified = false;
        this.selectedTier = null;
    },

    /**
     * Fetch SOL price and tiers from server (REST endpoint)
     * @returns {Promise<Object|null>} tier data
     */
    fetchTiers: async function () {
        try {
            var response = await fetch('/api/sol-price');
            var data = await response.json();
            if (data.error) {
                console.error('[PHANTOM] Failed to fetch tiers:', data.error);
                return null;
            }
            this.tiers = data.tiers;
            this.solPriceEur = data.solPriceEur;
            this.treasuryWallet = data.treasuryWallet;
            this.platformFeeSol = data.platformFeeSol;
            return data;
        } catch (err) {
            console.error('[PHANTOM] fetchTiers error:', err);
            return null;
        }
    },

    /**
     * Send SOL to treasury via Phantom
     * @param {number} amountSol - total SOL to send (entry fee + platform fee)
     * @returns {Promise<string|null>} transaction signature or null
     */
    sendPayment: async function (amountSol) {
        try {
            if (!this.provider || !this.connected) {
                console.error('[PHANTOM] Wallet not connected');
                return null;
            }

            // We need @solana/web3.js on the client side
            // Since we're using webpack, we can require it
            // But it's a large library. Instead, we'll construct the transaction manually
            // using the Phantom provider's signAndSendTransaction

            var solanaWeb3 = require('@solana/web3.js');

            var connection = new solanaWeb3.Connection(
                solanaWeb3.clusterApiUrl('mainnet-beta'),
                'confirmed'
            );

            var fromPubkey = this.provider.publicKey;
            var toPubkey = new solanaWeb3.PublicKey(this.treasuryWallet);

            var lamports = Math.round(amountSol * 1e9);

            var transaction = new solanaWeb3.Transaction().add(
                solanaWeb3.SystemProgram.transfer({
                    fromPubkey: fromPubkey,
                    toPubkey: toPubkey,
                    lamports: lamports,
                })
            );

            transaction.feePayer = fromPubkey;
            var latestBlockhash = await connection.getLatestBlockhash();
            transaction.recentBlockhash = latestBlockhash.blockhash;

            var { signature } = await this.provider.signAndSendTransaction(transaction);

            // Wait for confirmation
            await connection.confirmTransaction(signature, 'confirmed');
            console.log('[PHANTOM] Payment confirmed:', signature);
            return signature;
        } catch (err) {
            console.error('[PHANTOM] Payment failed:', err);
            return null;
        }
    },

    /**
     * Select a tier and initiate payment
     * @param {string} tierId - tier identifier ('small' or 'large')
     * @param {Object} socket - socket.io socket for server verification
     * @param {Function} onSuccess - callback on payment success
     * @param {Function} onError - callback on error
     */
    selectTierAndPay: async function (tierId, socket, onSuccess, onError) {
        var tier = this.tiers.find(function (t) { return t.id === tierId; });
        if (!tier) {
            onError('Invalid tier selected');
            return;
        }
        if (!tier.totalSolWithFee) {
            onError('SOL price unavailable, please retry');
            return;
        }

        this.selectedTier = tier;

        // Update UI to show "Processing payment..."
        this.updatePaymentStatus('sending');

        // Send the transaction via Phantom
        var txSignature = await this.sendPayment(tier.totalSolWithFee);
        if (!txSignature) {
            this.updatePaymentStatus('error');
            onError('Transaction failed or was rejected');
            return;
        }

        // Verify on server
        this.updatePaymentStatus('verifying');
        socket.emit('verifyPayment', {
            txSignature: txSignature,
            walletAddress: this.publicKey,
            tierId: tierId,
        });

        // Listen for server verification response (one-time)
        socket.once('paymentResult', function (result) {
            if (result.success) {
                this.paymentVerified = true;
                global.solBalance = result.solBalance;
                global.gamePoints = result.gamePoints;
                global.walletAddress = result.walletAddress;
                this.updatePaymentStatus('verified');
                onSuccess(result);
            } else {
                this.updatePaymentStatus('error');
                onError(result.error || 'Payment verification failed');
            }
        }.bind(this));
    },

    /**
     * Update payment status UI
     * @param {string} status - 'idle' | 'sending' | 'verifying' | 'verified' | 'error'
     */
    updatePaymentStatus: function (status) {
        var statusEl = document.getElementById('paymentStatus');
        if (!statusEl) return;

        var messages = {
            idle: '',
            sending: '⏳ Sending transaction via Phantom...',
            verifying: '🔍 Verifying payment on-chain...',
            verified: '✅ Payment verified! Ready to play.',
            error: '❌ Payment failed. Please try again.',
        };

        statusEl.textContent = messages[status] || '';
        statusEl.className = 'payment-status payment-' + status;
    },

    /**
     * Build the tier selection HTML
     * @returns {string} HTML string for tier buttons
     */
    buildTierHTML: function () {
        if (!this.tiers || this.tiers.length === 0) {
            return '<p class="tier-loading">Loading tiers...</p>';
        }

        var html = '';
        for (var i = 0; i < this.tiers.length; i++) {
            var tier = this.tiers[i];
            var solDisplay = tier.totalSolWithFee ? tier.totalSolWithFee.toFixed(4) + ' SOL' : '...';
            html += '<button class="tier-btn" data-tier="' + tier.id + '">';
            html += '<span class="tier-label">' + tier.label + '</span>';
            html += '<span class="tier-points">' + tier.gamePoints + ' pts</span>';
            html += '<span class="tier-sol">' + solDisplay + '</span>';
            html += '<span class="tier-eur">(€' + tier.eurValue.toFixed(2) + ' + €0.10 fee)</span>';
            html += '</button>';
        }
        return html;
    },

    /**
     * Format SOL balance for display
     */
    formatSol: function (amount) {
        if (!amount || amount === 0) return '0 SOL';
        if (amount < 0.001) return '<0.001 SOL';
        return amount.toFixed(4) + ' SOL';
    },
};

module.exports = PhantomWallet;
