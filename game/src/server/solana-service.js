/**
 * Solana Service
 * Handles on-chain transaction verification and payouts using @solana/web3.js
 */
'use strict';

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
    clusterApiUrl,
} = require('@solana/web3.js');
const bs58 = require('bs58');
const gameConfig = require('./game-config');
const solPrice = require('./sol-price');

let connection = null;
let serverKeypair = null;

/**
 * Initialize the Solana connection and server keypair
 */
function init() {
    const network = gameConfig.solanaNetwork;
    const rpcUrl = gameConfig.solanaRpcUrl || clusterApiUrl(network);
    connection = new Connection(rpcUrl, 'confirmed');
    console.log(`[SOLANA] Connected to ${network} via ${rpcUrl}`);

    // Load server keypair for payouts
    const privateKey = gameConfig.serverPrivateKey;
    if (privateKey) {
        try {
            const decoded = bs58.decode(privateKey);
            serverKeypair = Keypair.fromSecretKey(decoded);
            console.log(`[SOLANA] Server wallet loaded: ${serverKeypair.publicKey.toBase58()}`);
        } catch (err) {
            console.error('[SOLANA] Failed to load server private key:', err.message);
        }
    } else {
        console.warn('[SOLANA] No SERVER_PRIVATE_KEY set. Payouts will be disabled.');
    }
}

/**
 * Get the Solana connection instance
 */
function getConnection() {
    if (!connection) init();
    return connection;
}

/**
 * Verify an entry fee payment transaction on-chain
 *
 * @param {string} txSignature - The transaction signature/hash
 * @param {number} expectedAmountSol - Expected total SOL amount (entry + fee)
 * @param {string} fromWalletAddress - Player's wallet address
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function verifyPayment(txSignature, expectedAmountSol, fromWalletAddress) {
    try {
        const conn = getConnection();
        const treasuryAddress = gameConfig.treasuryWallet;

        if (!treasuryAddress) {
            return { valid: false, error: 'Treasury wallet not configured on server' };
        }

        // Fetch the transaction with retries
        let txInfo = null;
        for (let attempt = 0; attempt < 10; attempt++) {
            txInfo = await conn.getTransaction(txSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            });
            if (txInfo) break;
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!txInfo) {
            return { valid: false, error: 'Transaction not found on-chain' };
        }

        if (txInfo.meta.err) {
            return { valid: false, error: 'Transaction failed on-chain' };
        }

        // Parse account keys
        const accountKeys = txInfo.transaction.message.staticAccountKeys
            ? txInfo.transaction.message.staticAccountKeys.map(k => k.toBase58())
            : txInfo.transaction.message.accountKeys.map(k => k.toBase58());

        // Find the treasury account in pre/post balances
        const treasuryIndex = accountKeys.indexOf(treasuryAddress);
        const fromIndex = accountKeys.indexOf(fromWalletAddress);

        if (treasuryIndex === -1) {
            return { valid: false, error: 'Treasury wallet not found in transaction' };
        }
        if (fromIndex === -1) {
            return { valid: false, error: 'Player wallet not found as sender' };
        }

        // Check the transferred amount
        const preBal = txInfo.meta.preBalances[treasuryIndex];
        const postBal = txInfo.meta.postBalances[treasuryIndex];
        const transferredLamports = postBal - preBal;
        const expectedLamports = Math.round(expectedAmountSol * LAMPORTS_PER_SOL);

        // Allow 1% tolerance for rounding
        const tolerance = expectedLamports * 0.01;
        if (transferredLamports < expectedLamports - tolerance) {
            return {
                valid: false,
                error: `Insufficient payment: got ${transferredLamports / LAMPORTS_PER_SOL} SOL, expected ${expectedAmountSol} SOL`
            };
        }

        return { valid: true };
    } catch (err) {
        console.error('[SOLANA] verifyPayment error:', err);
        return { valid: false, error: 'Verification failed: ' + err.message };
    }
}

/**
 * Send a payout to a player's wallet (cash-out)
 *
 * @param {string} toWalletAddress - Recipient wallet address
 * @param {number} amountSol - Amount in SOL to send
 * @returns {Promise<{success: boolean, txSignature?: string, error?: string}>}
 */
async function sendPayout(toWalletAddress, amountSol) {
    try {
        if (!serverKeypair) {
            return { success: false, error: 'Server wallet not configured' };
        }

        if (amountSol <= 0) {
            return { success: false, error: 'Payout amount must be positive' };
        }

        const conn = getConnection();
        const toPubkey = new PublicKey(toWalletAddress);
        const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

        // Check server balance
        const balance = await conn.getBalance(serverKeypair.publicKey);
        const requiredLamports = lamports + 5000; // 5000 lamports for tx fee
        if (balance < requiredLamports) {
            console.error(`[SOLANA] Insufficient server balance: ${balance / LAMPORTS_PER_SOL} SOL, need ${requiredLamports / LAMPORTS_PER_SOL} SOL`);
            return { success: false, error: 'Server wallet has insufficient funds' };
        }

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: serverKeypair.publicKey,
                toPubkey: toPubkey,
                lamports: lamports,
            })
        );

        const { blockhash } = await conn.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = serverKeypair.publicKey;
        transaction.sign(serverKeypair);

        const txSignature = await conn.sendRawTransaction(transaction.serialize());
        await conn.confirmTransaction(txSignature, 'confirmed');

        console.log(`[SOLANA] Payout sent: ${amountSol} SOL to ${toWalletAddress} (tx: ${txSignature})`);
        return { success: true, txSignature };
    } catch (err) {
        console.error('[SOLANA] sendPayout error:', err);
        return { success: false, error: 'Payout failed: ' + err.message };
    }
}

/**
 * Get the server wallet's SOL balance
 */
async function getServerBalance() {
    try {
        if (!serverKeypair) return null;
        const conn = getConnection();
        const balance = await conn.getBalance(serverKeypair.publicKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (err) {
        console.error('[SOLANA] getServerBalance error:', err);
        return null;
    }
}

module.exports = {
    init,
    getConnection,
    verifyPayment,
    sendPayout,
    getServerBalance,
};
