/**
 * SOL Price Service
 * Fetches SOL/EUR price from CoinGecko and caches it.
 * Provides EUR→SOL conversion utilities.
 */
'use strict';

const https = require('https');

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur';
const CACHE_DURATION_MS = 60 * 1000; // 60 seconds

let cachedPrice = null;      // EUR per 1 SOL
let lastFetchTime = 0;
let fetchInProgress = false;

/**
 * Fetch SOL price from CoinGecko (EUR per 1 SOL)
 */
function fetchPrice() {
    if (fetchInProgress) return;
    fetchInProgress = true;

    return new Promise((resolve, reject) => {
        https.get(COINGECKO_URL, { headers: { 'Accept': 'application/json' } }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.solana && data.solana.eur) {
                        cachedPrice = data.solana.eur;
                        lastFetchTime = Date.now();
                        console.log(`[SOL-PRICE] Updated: 1 SOL = €${cachedPrice}`);
                    }
                    resolve(cachedPrice);
                } catch (err) {
                    console.error('[SOL-PRICE] Parse error:', err.message);
                    reject(err);
                } finally {
                    fetchInProgress = false;
                }
            });
        }).on('error', (err) => {
            console.error('[SOL-PRICE] Fetch error:', err.message);
            fetchInProgress = false;
            reject(err);
        });
    });
}

/**
 * Get current SOL price in EUR (1 SOL = X EUR).
 * Returns cached value if fresh, otherwise fetches.
 */
async function getSolPriceEur() {
    if (cachedPrice && (Date.now() - lastFetchTime < CACHE_DURATION_MS)) {
        return cachedPrice;
    }
    try {
        await fetchPrice();
    } catch (_) {
        // Use stale cache if available
    }
    return cachedPrice;
}

/**
 * Convert EUR amount to SOL amount
 * @param {number} eurAmount - Amount in EUR
 * @returns {Promise<number|null>} Amount in SOL, or null if price unavailable
 */
async function eurToSol(eurAmount) {
    const priceEur = await getSolPriceEur();
    if (!priceEur) return null;
    return eurAmount / priceEur;
}

/**
 * Convert SOL amount to EUR amount
 * @param {number} solAmount - Amount in SOL
 * @returns {Promise<number|null>} Amount in EUR, or null if price unavailable
 */
async function solToEur(solAmount) {
    const priceEur = await getSolPriceEur();
    if (!priceEur) return null;
    return solAmount * priceEur;
}

/**
 * Format SOL amount for display (6 decimal places max)
 */
function formatSol(amount) {
    if (amount == null) return '-.--- SOL';
    return amount.toFixed(6) + ' SOL';
}

/**
 * Convert SOL to lamports (1 SOL = 1,000,000,000 lamports)
 */
function solToLamports(sol) {
    return Math.round(sol * 1_000_000_000);
}

/**
 * Convert lamports to SOL
 */
function lamportsToSol(lamports) {
    return lamports / 1_000_000_000;
}

// Start periodic fetching
let priceInterval = null;
function startPriceUpdates() {
    fetchPrice().catch(() => {});
    priceInterval = setInterval(() => {
        fetchPrice().catch(() => {});
    }, CACHE_DURATION_MS);
}

function stopPriceUpdates() {
    if (priceInterval) {
        clearInterval(priceInterval);
        priceInterval = null;
    }
}

module.exports = {
    getSolPriceEur,
    eurToSol,
    solToEur,
    formatSol,
    solToLamports,
    lamportsToSol,
    startPriceUpdates,
    stopPriceUpdates,
};
