/**
 * Trading Journal Module — Forex-optimized
 * P&L = (exit - entry) * lots * lotSize - fees
 * Supports standard (100K), mini (10K), micro (1K) lot sizes.
 * Backward-compatible: old trades without lotSize default to lotSize=1.
 */
const Trading = (function () {
    'use strict';

    const STORAGE_KEY = 'was_trades';
    const ACCOUNTS_KEY = 'was_trading_accounts';
    const ACTIVE_ACCOUNT_KEY = 'was_active_trading_account';
    let equityChart = null;
    let selectedMonth = 'all'; // 'all' or 'YYYY-MM'

    // Trade math is in USD (the quote currency for most pairs we care about);
    // accounts can choose a display currency and a manual conversion rate.
    const CURRENCIES = [
        { code: 'USD', symbol: '$' },
        { code: 'EUR', symbol: '€' },
        { code: 'GBP', symbol: '£' },
        { code: 'CHF', symbol: 'CHF ' },
        { code: 'JPY', symbol: '¥' },
        { code: 'CAD', symbol: 'C$' },
        { code: 'AUD', symbol: 'A$' },
        { code: 'NZD', symbol: 'NZ$' }
    ];

    function getCurrencySymbol(code) {
        for (let i = 0; i < CURRENCIES.length; i++) {
            if (CURRENCIES[i].code === code) return CURRENCIES[i].symbol;
        }
        return (code || '') + ' ';
    }

    /** Returns { code, symbol, rate } for the active account, with safe defaults. */
    function getActiveCurrencyConfig() {
        const accounts = loadAccounts();
        const activeId = getActiveAccountId();
        let acct = null;
        for (let i = 0; i < accounts.length; i++) {
            if (accounts[i].id === activeId) { acct = accounts[i]; break; }
        }
        const code = (acct && acct.currency) ? acct.currency : 'USD';
        const rate = (acct && typeof acct.rateFromUSD === 'number' && acct.rateFromUSD > 0)
            ? acct.rateFromUSD : 1;
        return { code: code, symbol: getCurrencySymbol(code), rate: rate };
    }

    // ── Data Access ────────────────────────────────────────────────────

    function loadTrades() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('Trading: failed to load trades', e);
            return [];
        }
    }

    function saveTrades(trades) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
    }

    function loadAccounts() {
        try {
            const raw = localStorage.getItem(ACCOUNTS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.error('Trading: failed to load accounts', e);
            return [];
        }
    }

    function saveAccounts(accounts) {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    }

    function getActiveAccountId() {
        return localStorage.getItem(ACTIVE_ACCOUNT_KEY) || null;
    }

    function setActiveAccountId(id) {
        if (id) localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
        else localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    }

    /**
     * Ensure at least one account exists, all trades have an accountId,
     * and an active account is selected. Runs at init.
     */
    function ensureAccountsInitialized() {
        let accounts = loadAccounts();
        if (accounts.length === 0) {
            accounts = [{ id: App.generateId(), name: 'Default', currency: 'USD', rateFromUSD: 1 }];
            saveAccounts(accounts);
        } else {
            // Backfill currency/rate on accounts created before currency support
            let backfilled = false;
            for (let i = 0; i < accounts.length; i++) {
                if (!accounts[i].currency) { accounts[i].currency = 'USD'; backfilled = true; }
                if (typeof accounts[i].rateFromUSD !== 'number' || accounts[i].rateFromUSD <= 0) {
                    accounts[i].rateFromUSD = 1;
                    backfilled = true;
                }
            }
            if (backfilled) saveAccounts(accounts);
        }

        // Migrate any trades without accountId to the first account
        const trades = loadTrades();
        let migrated = false;
        for (let i = 0; i < trades.length; i++) {
            if (!trades[i].accountId) {
                trades[i].accountId = accounts[0].id;
                migrated = true;
            }
        }
        if (migrated) saveTrades(trades);

        // Ensure active account is valid
        let activeId = getActiveAccountId();
        const stillExists = activeId && accounts.some(function (a) { return a.id === activeId; });
        if (!stillExists) {
            setActiveAccountId(accounts[0].id);
        }
    }

    // ── P&L Calculation ───────────────────────────────────────────────

    function calcPnL(trade) {
        if ((trade.status !== 'closed' && trade.status !== 'early_close') || trade.exitPrice == null) {
            return null;
        }
        const lotSize = trade.lotSize || 1; // backward compat for old stock trades
        const diff = trade.type === 'long'
            ? trade.exitPrice - trade.entryPrice
            : trade.entryPrice - trade.exitPrice;
        return diff * trade.quantity * lotSize - (trade.fees || 0);
    }

    /**
     * Extra P&L left on the table when a trade was closed early and TP was still hit.
     * Reward from actual exit price to TP price, same lot-size math, no fees (already counted).
     */
    function calcLeftOnTable(trade) {
        if (trade.status !== 'early_close') return null;
        if (trade.tpHitAfterExit !== true) return null;
        if (trade.exitPrice == null || trade.tpPrice == null) return null;
        const lotSize = trade.lotSize || 1;
        const diff = trade.type === 'long'
            ? trade.tpPrice - trade.exitPrice
            : trade.exitPrice - trade.tpPrice;
        return diff * trade.quantity * lotSize;
    }

    /**
     * Planned R:R from SL/TP (what you aimed for).
     */
    function calcPlannedRR(trade) {
        if (trade.slPrice == null || trade.tpPrice == null) return null;
        var risk, reward;
        if (trade.type === 'long') {
            risk = trade.entryPrice - trade.slPrice;
            reward = trade.tpPrice - trade.entryPrice;
        } else {
            risk = trade.slPrice - trade.entryPrice;
            reward = trade.entryPrice - trade.tpPrice;
        }
        if (risk <= 0) return null;
        return Math.round((reward / risk) * 100) / 100;
    }

    /**
     * Actual R:R from SL and real exit (what you actually got).
     * Uses risk = |entry - SL| and reward = actual P&L direction.
     */
    function calcActualRR(trade) {
        if (trade.slPrice == null || trade.exitPrice == null || trade.status !== 'closed') return null;
        var risk, reward;
        if (trade.type === 'long') {
            risk = trade.entryPrice - trade.slPrice;
            reward = trade.exitPrice - trade.entryPrice;
        } else {
            risk = trade.slPrice - trade.entryPrice;
            reward = trade.entryPrice - trade.exitPrice;
        }
        if (risk <= 0) return null;
        return Math.round((reward / risk) * 100) / 100;
    }

    /**
     * Calculate pips for a forex trade.
     * JPY pairs (price > 10) use 0.01 pip size, others use 0.0001.
     */
    function calcPips(trade) {
        if (trade.status !== 'closed' || trade.exitPrice == null) return null;
        const diff = trade.type === 'long'
            ? trade.exitPrice - trade.entryPrice
            : trade.entryPrice - trade.exitPrice;
        // Detect JPY pair by price magnitude
        const pipSize = (trade.entryPrice > 10) ? 0.01 : 0.0001;
        return Math.round(diff / pipSize * 10) / 10;
    }

    // ── Statistics ─────────────────────────────────────────────────────

    function calcStats(trades) {
        // Sort closed trades by date so the equity curve is chronological
        // Early-closed trades are real trades with real outcomes — include them in all main stats
        const closedTrades = trades
            .filter(function (t) { return (t.status === 'closed' || t.status === 'early_close') && t.exitPrice != null; })
            .slice()
            .sort(function (a, b) {
                if (a.date < b.date) return -1;
                if (a.date > b.date) return 1;
                if (a.createdAt < b.createdAt) return -1;
                if (a.createdAt > b.createdAt) return 1;
                return 0;
            });

        const closedPnLs = [];
        for (let i = 0; i < closedTrades.length; i++) {
            const pnl = calcPnL(closedTrades[i]);
            if (pnl !== null) closedPnLs.push(pnl);
        }

        let totalPnL = 0, wins = [], losses = [];
        for (let j = 0; j < closedPnLs.length; j++) {
            totalPnL += closedPnLs[j];
            if (closedPnLs[j] > 0) wins.push(closedPnLs[j]);
            else if (closedPnLs[j] < 0) losses.push(closedPnLs[j]);
        }

        const closedCount = closedPnLs.length;

        // Streak calculation from date-sorted closed trades
        var currentWinStreak = 0;
        var currentLossStreak = 0;
        var maxWinStreak = 0;
        var maxLossStreak = 0;
        var tempWinStreak = 0;
        var tempLossStreak = 0;

        for (var s = 0; s < closedPnLs.length; s++) {
            if (closedPnLs[s] > 0) {
                tempWinStreak++;
                tempLossStreak = 0;
            } else if (closedPnLs[s] < 0) {
                tempLossStreak++;
                tempWinStreak = 0;
            } else {
                tempWinStreak = 0;
                tempLossStreak = 0;
            }
            if (tempWinStreak > maxWinStreak) maxWinStreak = tempWinStreak;
            if (tempLossStreak > maxLossStreak) maxLossStreak = tempLossStreak;
        }
        currentWinStreak = tempWinStreak;
        currentLossStreak = tempLossStreak;

        // Win rate (winning trades / closed trades — standard prop firm formula)
        const winRate = closedCount === 0
            ? '--'
            : ((wins.length / closedCount) * 100).toFixed(1) + '%';

        // Profit factor
        let profitFactor = '--';
        if (closedCount > 0) {
            if (wins.length === 0) profitFactor = '0.00';
            else if (losses.length === 0) profitFactor = '\u221E';
            else {
                const sumWins = wins.reduce((a, b) => a + b, 0);
                const sumLosses = losses.reduce((a, b) => a + b, 0);
                profitFactor = (sumWins / Math.abs(sumLosses)).toFixed(2);
            }
        }

        // Averages (raw USD numbers — formatted for display in renderStats)
        const avgWinRaw = wins.length === 0 ? 0
            : wins.reduce((a, b) => a + b, 0) / wins.length;
        const avgLossRaw = losses.length === 0 ? 0
            : Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length);

        // Best / Worst trade
        let bestTrade = closedPnLs.length ? Math.max(...closedPnLs) : null;
        let worstTrade = closedPnLs.length ? Math.min(...closedPnLs) : null;

        // Collect dates for the equity curve x-axis
        const closedDates = closedTrades.map(function (t) { return t.date; });

        // Planned R:R (from SL/TP)
        var plannedRRs = [];
        var actualRRs = [];
        for (var ri = 0; ri < trades.length; ri++) {
            var prr = calcPlannedRR(trades[ri]);
            if (prr !== null && prr > 0) plannedRRs.push(prr);
            var arr = calcActualRR(trades[ri]);
            if (arr !== null) actualRRs.push(arr);
        }
        var avgPlannedRR = plannedRRs.length > 0
            ? Math.round((plannedRRs.reduce(function(a, b) { return a + b; }, 0) / plannedRRs.length) * 100) / 100
            : null;
        var avgActualRR = actualRRs.length > 0
            ? Math.round((actualRRs.reduce(function(a, b) { return a + b; }, 0) / actualRRs.length) * 100) / 100
            : null;
        // Breakeven win rate based on actual avg win/loss (prop firm formula)
        // Formula: |Avg Loss| / (Avg Win + |Avg Loss|) × 100
        var breakevenWR = (avgWinRaw > 0 && avgLossRaw > 0)
            ? Math.round((avgLossRaw / (avgWinRaw + avgLossRaw)) * 1000) / 10
            : null;

        // Missed trades stats
        const missedTrades = trades.filter(function (t) { return t.status === 'missed'; });
        let missedPnL = 0;
        for (let mi = 0; mi < missedTrades.length; mi++) {
            const mp = calcMissedPnL(missedTrades[mi]);
            if (mp !== null) missedPnL += mp;
        }

        // Early-close stats: trades closed before TP, optionally tracking how much was left on the table
        const earlyCloseTrades = trades.filter(function (t) { return t.status === 'early_close'; });
        let leftOnTable = 0;
        for (let ei = 0; ei < earlyCloseTrades.length; ei++) {
            const lot = calcLeftOnTable(earlyCloseTrades[ei]);
            if (lot !== null) leftOnTable += lot;
        }

        return {
            totalPnL, winRate, totalTrades: closedCount, profitFactor,
            avgWin: avgWinRaw, avgLoss: avgLossRaw,
            bestTrade, worstTrade,
            hasWins: wins.length > 0, hasLosses: losses.length > 0,
            closedPnLs, closedDates,
            currentWinStreak: currentWinStreak,
            currentLossStreak: currentLossStreak,
            maxWinStreak: maxWinStreak,
            maxLossStreak: maxLossStreak,
            missedCount: missedTrades.length,
            missedPnL: missedPnL,
            earlyCloseCount: earlyCloseTrades.length,
            leftOnTable: leftOnTable,
            avgPlannedRR: avgPlannedRR,
            avgActualRR: avgActualRR,
            breakevenWR: breakevenWR
        };
    }

    // ── DOM Helpers ────────────────────────────────────────────────────

    function el(id) { return document.getElementById(id); }

    function todayISO() {
        const d = new Date();
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    /**
     * Format a USD value for display in the active account's currency.
     * Math is always in USD; conversion happens here at display time.
     */
    function formatPnL(value) {
        if (value === null || value === undefined) return '--';
        const cfg = getActiveCurrencyConfig();
        const converted = value * cfg.rate;
        const rounded = Math.round(converted * 100) / 100;
        return rounded >= 0
            ? '+' + cfg.symbol + rounded.toFixed(2)
            : '-' + cfg.symbol + Math.abs(rounded).toFixed(2);
    }

    /** Format an unsigned (always-positive) USD value in the active currency. */
    function formatMoneyAbs(value) {
        const cfg = getActiveCurrencyConfig();
        const converted = Math.abs(value || 0) * cfg.rate;
        return cfg.symbol + converted.toFixed(2);
    }

    function pnlClass(value) {
        if (value === null) return 'pnl-zero';
        if (value > 0) return 'pnl-positive';
        if (value < 0) return 'pnl-negative';
        return 'pnl-zero';
    }

    /** Format price with appropriate decimal places for forex */
    function formatPrice(val) {
        if (val == null) return '--';
        const num = parseFloat(val);
        // JPY pairs / large prices: 3 decimals; otherwise 5 decimals
        const decimals = num > 10 ? 3 : 5;
        return num.toFixed(decimals);
    }

    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ── Rendering ──────────────────────────────────────────────────────

    function renderStats(trades) {
        const stats = calcStats(trades);

        // Total P&L
        const totalPnLEl = el('stat-total-pnl');
        totalPnLEl.textContent = formatPnL(stats.totalPnL);
        totalPnLEl.classList.remove('positive', 'negative');
        if (stats.totalPnL > 0) totalPnLEl.classList.add('positive');
        else if (stats.totalPnL < 0) totalPnLEl.classList.add('negative');

        el('stat-win-rate').textContent = stats.winRate;
        el('stat-total-trades').textContent = stats.totalTrades;
        el('stat-profit-factor').textContent = stats.profitFactor;

        // Avg Win (always positive — show without leading +)
        const avgWinEl = el('stat-avg-win');
        avgWinEl.textContent = formatMoneyAbs(stats.avgWin);
        avgWinEl.classList.remove('positive', 'negative');
        if (stats.hasWins) avgWinEl.classList.add('positive');

        // Avg Loss (stored as absolute value — show with explicit minus)
        const avgLossEl = el('stat-avg-loss');
        avgLossEl.textContent = stats.hasLosses ? '-' + formatMoneyAbs(stats.avgLoss) : formatMoneyAbs(0);
        avgLossEl.classList.remove('positive', 'negative');
        if (stats.hasLosses) avgLossEl.classList.add('negative');

        // Best Trade
        const bestEl = el('stat-best-trade');
        if (bestEl) {
            bestEl.textContent = formatPnL(stats.bestTrade);
            bestEl.classList.remove('positive', 'negative');
            if (stats.bestTrade > 0) bestEl.classList.add('positive');
        }

        // Worst Trade
        const worstEl = el('stat-worst-trade');
        if (worstEl) {
            worstEl.textContent = formatPnL(stats.worstTrade);
            worstEl.classList.remove('positive', 'negative');
            if (stats.worstTrade < 0) worstEl.classList.add('negative');
        }

        // Win Streak
        var winStreakEl = el('stat-win-streak');
        if (winStreakEl) {
            var winBadge = winStreakEl.querySelector('.streak-badge-win');
            if (winBadge) winBadge.textContent = stats.currentWinStreak;
        }

        // Loss Streak
        var lossStreakEl = el('stat-loss-streak');
        if (lossStreakEl) {
            var lossBadge = lossStreakEl.querySelector('.streak-badge-loss');
            if (lossBadge) lossBadge.textContent = stats.currentLossStreak;
        }

        // Avg Planned R:R
        var avgPRREl = el('stat-avg-planned-rr');
        if (avgPRREl) avgPRREl.textContent = stats.avgPlannedRR !== null ? '1:' + stats.avgPlannedRR.toFixed(2) : '--';

        // Avg Actual R:R (R-multiple format)
        var avgARREl = el('stat-avg-actual-rr');
        if (avgARREl) {
            if (stats.avgActualRR !== null) {
                avgARREl.textContent = (stats.avgActualRR >= 0 ? '+' : '') + stats.avgActualRR.toFixed(2) + 'R';
                avgARREl.classList.remove('positive', 'negative');
                if (stats.avgActualRR > 0) avgARREl.classList.add('positive');
                else if (stats.avgActualRR < 0) avgARREl.classList.add('negative');
            } else {
                avgARREl.textContent = '--';
                avgARREl.classList.remove('positive', 'negative');
            }
        }

        // Breakeven WR
        var beWREl = el('stat-breakeven-wr');
        if (beWREl) beWREl.textContent = stats.breakevenWR !== null ? stats.breakevenWR + '%' : '--';

        // Missed trades
        var missedCard = el('stat-missed-card');
        var missedPnlCard = el('stat-missed-pnl-card');
        if (missedCard && missedPnlCard) {
            if (stats.missedCount > 0) {
                missedCard.style.display = '';
                missedPnlCard.style.display = '';
                el('stat-missed-count').textContent = stats.missedCount;
                var missedPnlEl = el('stat-missed-pnl');
                var roundedMissed = Math.round(stats.missedPnL * 100) / 100;
                missedPnlEl.textContent = formatPnL(roundedMissed);
                missedPnlEl.classList.remove('positive', 'negative');
                if (roundedMissed > 0) missedPnlEl.classList.add('positive');
                else if (roundedMissed < 0) missedPnlEl.classList.add('negative');
            } else {
                missedCard.style.display = 'none';
                missedPnlCard.style.display = 'none';
            }
        }

        // Early-closed trades (closed before TP)
        var earlyCard = el('stat-early-close-card');
        var lotCard = el('stat-left-on-table-card');
        if (earlyCard && lotCard) {
            if (stats.earlyCloseCount > 0) {
                earlyCard.style.display = '';
                lotCard.style.display = '';
                el('stat-early-close-count').textContent = stats.earlyCloseCount;
                var lotEl = el('stat-left-on-table');
                var roundedLot = Math.round(stats.leftOnTable * 100) / 100;
                lotEl.textContent = formatPnL(roundedLot);
                lotEl.classList.remove('positive', 'negative');
                // Left on table represents gains given up — color positive (green) when > 0
                if (roundedLot > 0) lotEl.classList.add('positive');
                else if (roundedLot < 0) lotEl.classList.add('negative');
            } else {
                earlyCard.style.display = 'none';
                lotCard.style.display = 'none';
            }
        }

        // Equity curve
        renderEquityCurve(stats.closedPnLs, stats.closedDates);
    }

    function renderEquityCurve(closedPnLs, closedDates) {
        closedDates = closedDates || [];
        const canvas = el('equity-curve');
        if (!canvas || closedPnLs.length === 0) {
            const container = el('equity-curve-card');
            if (container) container.style.display = closedPnLs.length === 0 ? 'none' : '';
            return;
        }
        const container = el('equity-curve-card');
        if (container) container.style.display = '';

        // Build cumulative equity in the active account's display currency
        const cfg = getActiveCurrencyConfig();
        const equityData = [0];
        let running = 0;
        for (let i = 0; i < closedPnLs.length; i++) {
            running += closedPnLs[i];
            equityData.push(Math.round(running * cfg.rate * 100) / 100);
        }

        // Use dates for x-axis labels (first point is "Start")
        const labels = equityData.map(function (_, i) {
            if (i === 0) return 'Start';
            var d = closedDates[i - 1];
            if (d) {
                // Format YYYY-MM-DD → "Mar 17" style
                var parts = d.split('-');
                if (parts.length === 3) {
                    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
                }
            }
            return '#' + i;
        });

        if (equityChart) {
            equityChart.destroy();
            equityChart = null;
        }

        const isPositive = equityData[equityData.length - 1] >= 0;
        const lineColor = isPositive ? '#22c55e' : '#ef4444';

        // Create gradient fill
        var ctx2d = canvas.getContext('2d');
        var gradient = ctx2d.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight || 280);
        if (isPositive) {
            gradient.addColorStop(0, 'rgba(34, 197, 94, 0.2)');
            gradient.addColorStop(0.5, 'rgba(34, 197, 94, 0.05)');
            gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
        } else {
            gradient.addColorStop(0, 'rgba(239, 68, 68, 0.2)');
            gradient.addColorStop(0.5, 'rgba(239, 68, 68, 0.05)');
            gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
        }

        equityChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Equity',
                    data: equityData,
                    borderColor: lineColor,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.35,
                    pointRadius: equityData.length > 20 ? 0 : 4,
                    pointHoverRadius: 7,
                    pointBackgroundColor: lineColor,
                    pointBorderColor: '#0d0d22',
                    pointBorderWidth: 2,
                    pointHoverBorderWidth: 3,
                    borderWidth: 2.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800, easing: 'easeOutQuart' },
                interaction: { intersect: false, mode: 'index' },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                        ticks: { color: '#5a5a78', maxTicksLimit: 10, font: { size: 11 } }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                        ticks: {
                            color: '#9898b0',
                            callback: function (v) { return cfg.symbol + v; },
                            font: { size: 11 }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(13, 13, 34, 0.9)',
                        borderColor: 'rgba(124, 92, 252, 0.2)',
                        borderWidth: 1,
                        titleColor: '#ededff',
                        bodyColor: '#a0a0c0',
                        cornerRadius: 10,
                        padding: 12,
                        callbacks: {
                            label: function (ctx) { return 'Equity: ' + cfg.symbol + ctx.parsed.y.toFixed(2); }
                        }
                    }
                }
            }
        });
    }

    function renderTable(trades) {
        const tbody = el('trades-tbody');
        const table = el('trades-table');
        const empty = el('trades-empty');
        const tableContainer = table ? table.closest('.table-container') : null;

        if (!trades.length) {
            if (tableContainer) tableContainer.style.display = 'none';
            empty.style.display = '';
            tbody.innerHTML = '';
            return;
        }

        if (tableContainer) tableContainer.style.display = '';
        empty.style.display = 'none';

        const sorted = trades.slice().sort(function (a, b) {
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            if (a.createdAt > b.createdAt) return -1;
            if (a.createdAt < b.createdAt) return 1;
            return 0;
        });

        // Only show the "copy to other accounts" button when there's somewhere to copy to
        const hasOtherAccounts = loadAccounts().length > 1;

        let html = '';
        for (let i = 0; i < sorted.length; i++) {
            const t = sorted[i];
            const isMissed = t.status === 'missed';
            const pnl = isMissed ? null : calcPnL(t);
            const missedPnl = isMissed ? calcMissedPnL(t) : null;
            const pips = isMissed ? null : calcPips(t);
            const pCls = isMissed ? '' : pnlClass(pnl);
            const displayDate = typeof App !== 'undefined' && App.formatDate
                ? App.formatDate(t.date) : t.date;

            const pipsStr = pips !== null
                ? '<span class="trade-pips ' + (pips >= 0 ? 'pips-positive' : 'pips-negative') + '">'
                  + (pips >= 0 ? '+' : '') + pips + ' pips</span>'
                : '';

            // For missed trades, show potential P&L
            let pnlCell = '';
            if (isMissed) {
                pnlCell = '<div class="potential-pnl">' + (missedPnl !== null ? formatPnL(missedPnl) : '--') + '</div>'
                        + '<div class="potential-pnl">potential</div>';
            } else {
                pnlCell = '<div>' + formatPnL(pnl) + '</div>' + pipsStr;
                // Early-closed trades where TP was hit: show how much was left on the table
                if (t.status === 'early_close' && t.tpHitAfterExit === true) {
                    const lot = calcLeftOnTable(t);
                    if (lot !== null) {
                        pnlCell += '<div class="potential-pnl">' + formatPnL(lot) + ' left on TP</div>';
                    }
                }
            }

            const plannedRR = calcPlannedRR(t);
            const actualRR = calcActualRR(t);
            const plannedRRStr = plannedRR !== null ? '1:' + plannedRR.toFixed(2) : '--';
            // Actual R:R as R-multiple (e.g. +2.00R, -0.50R, -1.00R = hit SL)
            const actualRRStr = actualRR !== null ? (actualRR >= 0 ? '+' : '') + actualRR.toFixed(2) + 'R' : '--';

            html += '<tr class="' + (isMissed ? 'trade-row-missed' : '') + '">'
                + '<td>' + escapeHTML(displayDate) + '</td>'
                + '<td><strong>' + escapeHTML(t.ticker) + '</strong></td>'
                + '<td><span class="trade-type-' + t.type + '">' + t.type + '</span></td>'
                + '<td><span class="trade-status-' + t.status + '">' + t.status + '</span></td>'
                + '<td class="td-mono">' + formatPrice(t.entryPrice) + '</td>'
                + '<td class="td-mono td-sl">' + (t.slPrice != null ? formatPrice(t.slPrice) : '--') + '</td>'
                + '<td class="td-mono td-tp">' + (t.tpPrice != null ? formatPrice(t.tpPrice) : '--') + '</td>'
                + '<td class="td-mono">' + (t.exitPrice != null ? formatPrice(t.exitPrice) : '--') + '</td>'
                + '<td>' + t.quantity + '</td>'
                + '<td class="td-rr">' + plannedRRStr + '</td>'
                + '<td class="td-rr ' + (actualRR !== null ? (actualRR > 0 ? 'pnl-positive' : actualRR < 0 ? 'pnl-negative' : '') : '') + '">' + actualRRStr + '</td>'
                + '<td class="' + pCls + '">'
                +     pnlCell
                + '</td>'
                + '<td class="td-actions">'
                + '<button class="btn-icon" data-action="edit" data-id="' + t.id + '" title="Edit">'
                + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
                + '</button>'
                + (hasOtherAccounts
                    ? '<button class="btn-icon" data-action="copy" data-id="' + t.id + '" title="Copy to other accounts">'
                      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
                      + '</button>'
                    : '')
                + '<button class="btn-icon" data-action="delete" data-id="' + t.id + '" title="Delete">'
                + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
                + '</button>'
                + '</td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
    }

    function filterTradesByAccount(trades) {
        const activeId = getActiveAccountId();
        if (!activeId) return trades;
        return trades.filter(function (t) { return t.accountId === activeId; });
    }

    function populateAccountFilter() {
        var select = el('trading-account-filter');
        if (!select) return;
        var accounts = loadAccounts();
        var activeId = getActiveAccountId();
        select.innerHTML = '';
        for (var i = 0; i < accounts.length; i++) {
            var opt = document.createElement('option');
            opt.value = accounts[i].id;
            opt.textContent = accounts[i].name;
            if (accounts[i].id === activeId) opt.selected = true;
            select.appendChild(opt);
        }
    }

    function filterTradesByMonth(trades) {
        if (selectedMonth === 'all') return trades;
        return trades.filter(function (t) {
            return t.date && t.date.substring(0, 7) === selectedMonth;
        });
    }

    function populateMonthFilter(trades) {
        var select = el('trading-month-filter');
        if (!select) return;

        // Collect unique months from all trades
        var monthSet = {};
        for (var i = 0; i < trades.length; i++) {
            if (trades[i].date) {
                var ym = trades[i].date.substring(0, 7);
                monthSet[ym] = true;
            }
        }
        var months = Object.keys(monthSet).sort().reverse();

        // Preserve current selection
        var prev = select.value;
        select.innerHTML = '<option value="all">All Time</option>';

        var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        for (var m = 0; m < months.length; m++) {
            var parts = months[m].split('-');
            var label = monthNames[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
            var opt = document.createElement('option');
            opt.value = months[m];
            opt.textContent = label;
            select.appendChild(opt);
        }

        // Restore selection if still valid
        if (prev && select.querySelector('option[value="' + prev + '"]')) {
            select.value = prev;
            selectedMonth = prev;
        } else {
            select.value = selectedMonth;
        }
    }

    function render() {
        populateAccountFilter();
        const accountTrades = filterTradesByAccount(loadTrades());
        populateMonthFilter(accountTrades);
        const trades = filterTradesByMonth(accountTrades);
        renderStats(trades);
        renderTable(trades);
        // Notify listeners (e.g., AI Coach sidebar) that the active view changed
        try {
            document.dispatchEvent(new CustomEvent('trading:trades-changed', {
                detail: { accountTradeCount: accountTrades.length }
            }));
        } catch (e) { /* CustomEvent unsupported in ancient browsers — ignore */ }
    }

    // ── Modal / Form ──────────────────────────────────────────────────

    /** Show "(CHF)" or whichever active currency next to the Fees label. */
    function updateFeesCurrencyHint() {
        const hint = el('trade-fees-currency-hint');
        if (!hint) return;
        const cfg = getActiveCurrencyConfig();
        hint.textContent = '(' + cfg.code + ')';
    }

    function resetForm() {
        const form = el('trade-form');
        if (form) form.reset();
        el('trade-id').value = '';
        el('trade-date').value = todayISO();
        el('trade-type').value = 'long';
        el('trade-status').value = 'closed';
        el('trade-entry').value = '';
        el('trade-exit').value = '';
        el('trade-exit').disabled = false;
        el('trade-sl').value = '';
        el('trade-tp').value = '';
        el('trade-quantity').value = '';
        el('trade-lot-size').value = '100000';
        el('trade-fees').value = '0';
        el('trade-notes').value = '';
        el('trade-ticker').value = '';
        const tpHit = el('trade-tp-hit');
        if (tpHit) tpHit.checked = false;
        const tpHitRow = el('trade-tp-hit-row');
        if (tpHitRow) tpHitRow.style.display = 'none';
        updateFeesCurrencyHint();
        el('trade-modal-title').textContent = 'Add Trade';
    }

    /**
     * Render checkboxes for every account when the user is ADDING a trade,
     * pre-checking the active account. Hides the row entirely when there's
     * only one account (the implicit single-account case).
     */
    function populateTradeAccountsCheckboxes() {
        const row = el('trade-accounts-row');
        const container = el('trade-accounts-checkboxes');
        if (!row || !container) return;
        const accounts = loadAccounts();
        const activeId = getActiveAccountId();

        if (accounts.length <= 1) {
            row.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        let html = '';
        for (let i = 0; i < accounts.length; i++) {
            const a = accounts[i];
            const checked = a.id === activeId ? ' checked' : '';
            const currencyTag = a.currency && a.currency !== 'USD' ? ' <span class="trade-accounts-currency">(' + a.currency + ')</span>' : '';
            html += '<label class="trade-accounts-checkbox">'
                + '<input type="checkbox" value="' + a.id + '"' + checked + '>'
                + '<span>' + (a.name || 'Unnamed') + currencyTag + '</span>'
                + '</label>';
        }
        container.innerHTML = html;
        row.style.display = '';
    }

    function openAddModal() {
        resetForm();
        populateTradeAccountsCheckboxes();
        App.showModal('trade-modal');
    }

    function openEditModal(id) {
        const trades = loadTrades();
        const trade = trades.find(t => t.id === id);
        if (!trade) return;

        resetForm();
        // Editing one specific trade — hide the multi-account chooser entirely
        const accountsRow = el('trade-accounts-row');
        if (accountsRow) accountsRow.style.display = 'none';
        el('trade-modal-title').textContent = 'Edit Trade';
        el('trade-id').value = trade.id;
        el('trade-date').value = trade.date;
        el('trade-ticker').value = trade.ticker;
        el('trade-type').value = trade.type;
        el('trade-status').value = trade.status;
        el('trade-entry').value = trade.entryPrice;
        el('trade-sl').value = trade.slPrice != null ? trade.slPrice : '';
        el('trade-tp').value = trade.tpPrice != null ? trade.tpPrice : '';
        el('trade-lot-size').value = String(trade.lotSize || 100000);

        if (trade.status === 'closed' || trade.status === 'missed' || trade.status === 'early_close') {
            el('trade-exit').disabled = false;
            el('trade-exit').value = trade.exitPrice != null ? trade.exitPrice : '';
        } else {
            el('trade-exit').disabled = true;
            el('trade-exit').value = '';
        }
        el('trade-quantity').value = trade.quantity;
        // Fees are stored in USD — convert back to the active account's currency for display
        const feeCfg = getActiveCurrencyConfig();
        const displayFee = (typeof trade.fees === 'number') ? trade.fees * feeCfg.rate : 0;
        el('trade-fees').value = Math.round(displayFee * 100) / 100;
        el('trade-notes').value = trade.notes || '';

        const tpHit = el('trade-tp-hit');
        if (tpHit) tpHit.checked = trade.tpHitAfterExit === true;
        handleStatusChange();

        App.showModal('trade-modal');
    }

    function handleStatusChange() {
        const status = el('trade-status').value;
        const exitField = el('trade-exit');
        if (status === 'open') {
            exitField.value = '';
            exitField.disabled = true;
        } else {
            exitField.disabled = false;
        }

        // TP-hit checkbox only applies to early_close
        const tpHitRow = el('trade-tp-hit-row');
        if (tpHitRow) {
            if (status === 'early_close') {
                tpHitRow.style.display = '';
            } else {
                tpHitRow.style.display = 'none';
                const tpHit = el('trade-tp-hit');
                if (tpHit) tpHit.checked = false;
            }
        }
    }

    /**
     * Calculate P&L for a missed trade (what you would have made/lost).
     * Same math as calcPnL but works on missed status.
     */
    function calcMissedPnL(trade) {
        if (trade.status !== 'missed' || trade.exitPrice == null) return null;
        const lotSize = trade.lotSize || 1;
        const diff = trade.type === 'long'
            ? trade.exitPrice - trade.entryPrice
            : trade.entryPrice - trade.exitPrice;
        return diff * trade.quantity * lotSize - (trade.fees || 0);
    }

    function handleFormSubmit(e) {
        e.preventDefault();

        const id = el('trade-id').value;
        const date = el('trade-date').value.trim();
        const ticker = el('trade-ticker').value.trim().toUpperCase();
        const type = el('trade-type').value;
        const status = el('trade-status').value;
        const entryPrice = parseFloat(el('trade-entry').value);
        const exitRaw = el('trade-exit').value.trim();
        const statusNeedsExit = (status === 'closed' || status === 'missed' || status === 'early_close');
        const exitPrice = (statusNeedsExit && exitRaw !== '') ? parseFloat(exitRaw) : null;
        const slRaw = el('trade-sl').value.trim();
        const slPrice = slRaw !== '' ? parseFloat(slRaw) : null;
        const tpRaw = el('trade-tp').value.trim();
        const tpPrice = tpRaw !== '' ? parseFloat(tpRaw) : null;
        const quantity = parseFloat(el('trade-quantity').value);
        const lotSize = parseInt(el('trade-lot-size').value, 10) || 100000;
        // User enters fees in the active account's currency; trade math is in USD
        const feesEntered = parseFloat(el('trade-fees').value) || 0;
        const submitCfg = getActiveCurrencyConfig();
        const fees = (submitCfg.rate > 0) ? (feesEntered / submitCfg.rate) : feesEntered;
        const notes = el('trade-notes').value.trim();
        const tpHitEl = el('trade-tp-hit');
        const tpHitAfterExit = (status === 'early_close' && tpHitEl) ? tpHitEl.checked : false;

        // Validation
        if (!date) { App.toast('Please enter a date.', 'error'); return; }
        if (!ticker) { App.toast('Please enter a pair symbol.', 'error'); return; }
        if (isNaN(entryPrice) || entryPrice <= 0) { App.toast('Please enter a valid entry price.', 'error'); return; }
        if (statusNeedsExit && (exitPrice === null || isNaN(exitPrice) || exitPrice <= 0)) {
            App.toast('Please enter a valid exit price for a ' + status + ' trade.', 'error'); return;
        }
        if (isNaN(quantity) || quantity <= 0) { App.toast('Please enter valid lots.', 'error'); return; }
        if (isNaN(fees) || fees < 0) { App.toast('Fees cannot be negative.', 'error'); return; }
        if (tpHitAfterExit && tpPrice == null) {
            App.toast('Enter a Take Profit price to track what was left on the table.', 'error'); return;
        }

        const trades = loadTrades();
        const isEdit = !!id;

        if (isEdit) {
            const trade = trades.find(t => t.id === id);
            if (trade) {
                Object.assign(trade, {
                    date, ticker, type, status, entryPrice, exitPrice,
                    slPrice, tpPrice, quantity, lotSize, fees, notes,
                    tpHitAfterExit: tpHitAfterExit
                });
            }
            App.toast('Trade updated.', 'success');
        } else {
            // Determine which accounts to save to (active by default; multi-select if visible)
            let accountIds = [getActiveAccountId()];
            const accountsRow = el('trade-accounts-row');
            if (accountsRow && accountsRow.style.display !== 'none') {
                const checked = el('trade-accounts-checkboxes').querySelectorAll('input[type="checkbox"]:checked');
                accountIds = Array.prototype.map.call(checked, function (c) { return c.value; });
                if (accountIds.length === 0) {
                    App.toast('Pick at least one account to save to.', 'error');
                    return;
                }
            }

            // Same createdAt across the duplicates — useful if we ever want to
            // identify "linked" trades for batch delete/edit later
            const sharedCreatedAt = new Date().toISOString();
            for (let ai = 0; ai < accountIds.length; ai++) {
                trades.push({
                    id: App.generateId(),
                    accountId: accountIds[ai],
                    date, ticker, type, status,
                    entryPrice, exitPrice, slPrice, tpPrice,
                    quantity, lotSize, fees, notes,
                    tpHitAfterExit: tpHitAfterExit,
                    createdAt: sharedCreatedAt
                });
            }
            App.toast(
                accountIds.length === 1
                    ? 'Trade added.'
                    : 'Trade saved to ' + accountIds.length + ' accounts.',
                'success'
            );
        }

        saveTrades(trades);
        App.closeModal('trade-modal');
        render();
    }

    function deleteTrade(id) {
        if (!confirm('Delete this trade?')) return;
        const trades = loadTrades().filter(t => t.id !== id);
        saveTrades(trades);
        App.toast('Trade deleted.', 'success');
        render();
    }

    // ── Copy trade to other accounts ─────────────────────────────────

    /** Open the Copy Trade modal for an existing trade. Lists every account
     *  the trade isn't already on. Currency conversion handles itself at
     *  display time, so we just duplicate the USD-denominated record. */
    function openCopyTradeModal(tradeId) {
        const trade = loadTrades().find(function (t) { return t.id === tradeId; });
        if (!trade) return;
        const accounts = loadAccounts();
        const targets = accounts.filter(function (a) { return a.id !== trade.accountId; });
        if (targets.length === 0) {
            App.toast('No other accounts to copy to. Add another account first.', 'error');
            return;
        }

        // Summary line so the user knows what they're copying
        const sourceAcct = accounts.find(function (a) { return a.id === trade.accountId; });
        const sourceName = sourceAcct ? sourceAcct.name : '(unknown)';
        const summary = el('copy-trade-summary');
        if (summary) {
            summary.textContent =
                'Source: ' + sourceName + ' · ' + trade.date + ' · ' + trade.ticker + ' ' + trade.type
                + ' (' + trade.status + ')';
        }
        el('copy-trade-id').value = tradeId;

        // Render target checkboxes — all unchecked by default so user has to opt in
        const container = el('copy-trade-targets');
        let html = '';
        for (let i = 0; i < targets.length; i++) {
            const a = targets[i];
            const currencyTag = a.currency && a.currency !== 'USD' ? ' <span class="trade-accounts-currency">(' + a.currency + ')</span>' : '';
            html += '<label class="trade-accounts-checkbox">'
                + '<input type="checkbox" value="' + a.id + '">'
                + '<span>' + (a.name || 'Unnamed') + currencyTag + '</span>'
                + '</label>';
        }
        container.innerHTML = html;

        App.showModal('copy-trade-modal');
    }

    function handleCopyTradeConfirm() {
        const tradeId = el('copy-trade-id').value;
        const trades = loadTrades();
        const source = trades.find(function (t) { return t.id === tradeId; });
        if (!source) { App.closeModal('copy-trade-modal'); return; }

        const checked = el('copy-trade-targets').querySelectorAll('input[type="checkbox"]:checked');
        const targetIds = Array.prototype.map.call(checked, function (c) { return c.value; });
        if (targetIds.length === 0) {
            App.toast('Pick at least one account to copy to.', 'error');
            return;
        }

        const sharedCreatedAt = new Date().toISOString();
        for (let i = 0; i < targetIds.length; i++) {
            // Shallow copy then override id + accountId + createdAt
            const copy = {};
            for (const k in source) {
                if (Object.prototype.hasOwnProperty.call(source, k)) copy[k] = source[k];
            }
            copy.id = App.generateId();
            copy.accountId = targetIds[i];
            copy.createdAt = sharedCreatedAt;
            trades.push(copy);
        }
        saveTrades(trades);
        App.closeModal('copy-trade-modal');
        App.toast(
            targetIds.length === 1
                ? 'Trade copied to 1 account.'
                : 'Trade copied to ' + targetIds.length + ' accounts.',
            'success'
        );
        render();
    }

    // ── Account Manager Modal ─────────────────────────────────────────

    function escapeAttr(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderAccountManagerList() {
        const container = el('account-manager-list');
        if (!container) return;
        const accounts = loadAccounts();
        let html = '';
        for (let i = 0; i < accounts.length; i++) {
            const acct = accounts[i];
            const currency = acct.currency || 'USD';
            const rate = (typeof acct.rateFromUSD === 'number' && acct.rateFromUSD > 0) ? acct.rateFromUSD : 1;
            let currencyOptions = '';
            for (let c = 0; c < CURRENCIES.length; c++) {
                const sel = CURRENCIES[c].code === currency ? ' selected' : '';
                currencyOptions += '<option value="' + CURRENCIES[c].code + '"' + sel + '>'
                    + CURRENCIES[c].code + '</option>';
            }
            html += '<div class="account-manager-item" data-account-id="' + acct.id + '">'
                + '<input type="text" class="input account-manager-input" value="' + escapeAttr(acct.name) + '" placeholder="Name">'
                + '<select class="input account-manager-currency">' + currencyOptions + '</select>'
                + '<input type="number" class="input account-manager-rate" value="' + rate + '" step="0.0001" min="0.0001" title="1 USD = X (account currency)">'
                + '<button class="btn-icon btn-danger-icon" data-action="delete-account" title="Delete account and its trades">'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'
                + '</button>'
                + '</div>';
        }
        if (accounts.length === 0) {
            html = '<div class="empty-state-mini">No accounts yet. Add one above.</div>';
        }
        container.innerHTML = '<div class="account-manager-header">'
            + '<span>Name</span><span>Currency</span><span title="1 USD = X account currency">Rate from USD</span><span></span>'
            + '</div>' + html;

        // When the user picks USD, snap rate to 1 (a USD account never converts)
        const selects = container.querySelectorAll('.account-manager-currency');
        for (let s = 0; s < selects.length; s++) {
            selects[s].addEventListener('change', function () {
                const row = this.closest('.account-manager-item');
                if (!row) return;
                const rateInput = row.querySelector('.account-manager-rate');
                if (this.value === 'USD' && rateInput) {
                    rateInput.value = 1;
                }
            });
        }
    }

    function openAccountManager() {
        renderAccountManagerList();
        App.showModal('account-manager-modal');
    }

    function handleAccountManagerAdd() {
        const input = el('account-manager-new');
        if (!input) return;
        const name = input.value.trim();
        if (!name) return;
        const accounts = loadAccounts();
        accounts.push({ id: App.generateId(), name: name, currency: 'USD', rateFromUSD: 1 });
        saveAccounts(accounts);
        input.value = '';
        renderAccountManagerList();
    }

    function handleAccountManagerListClick(e) {
        const btn = e.target.closest('[data-action="delete-account"]');
        if (!btn) return;
        const item = btn.closest('.account-manager-item');
        if (!item) return;
        const accountId = item.getAttribute('data-account-id');

        const accounts = loadAccounts();
        if (accounts.length <= 1) {
            App.toast('You must have at least one account.', 'error');
            return;
        }
        const account = accounts.find(function (a) { return a.id === accountId; });
        const name = account ? account.name : 'this account';
        const tradeCount = loadTrades().filter(function (t) { return t.accountId === accountId; }).length;
        const msg = tradeCount > 0
            ? 'Delete account "' + name + '" and its ' + tradeCount + ' trade(s)? This cannot be undone.'
            : 'Delete account "' + name + '"?';
        if (!confirm(msg)) return;

        // Cascade delete: remove the account and all its trades
        const remainingAccounts = accounts.filter(function (a) { return a.id !== accountId; });
        const remainingTrades = loadTrades().filter(function (t) { return t.accountId !== accountId; });
        saveAccounts(remainingAccounts);
        saveTrades(remainingTrades);

        // If we deleted the active account, switch to the first remaining
        if (getActiveAccountId() === accountId) {
            setActiveAccountId(remainingAccounts[0].id);
        }

        renderAccountManagerList();
    }

    function handleAccountManagerSave() {
        const container = el('account-manager-list');
        if (!container) return;
        const items = container.querySelectorAll('.account-manager-item');
        const accounts = loadAccounts();
        for (let i = 0; i < items.length; i++) {
            const id = items[i].getAttribute('data-account-id');
            const newName = items[i].querySelector('.account-manager-input').value.trim();
            const newCurrency = items[i].querySelector('.account-manager-currency').value;
            const rateRaw = parseFloat(items[i].querySelector('.account-manager-rate').value);
            const newRate = (!isNaN(rateRaw) && rateRaw > 0) ? rateRaw : 1;
            for (let j = 0; j < accounts.length; j++) {
                if (accounts[j].id === id) {
                    if (newName) accounts[j].name = newName;
                    accounts[j].currency = newCurrency || 'USD';
                    // Snap to 1 for USD; otherwise honour the entered rate
                    accounts[j].rateFromUSD = (accounts[j].currency === 'USD') ? 1 : newRate;
                }
            }
        }
        saveAccounts(accounts);
        App.closeModal('account-manager-modal');
        App.toast('Accounts saved.', 'success');
        render();
    }

    // ── Event Binding ─────────────────────────────────────────────────

    function bindEvents() {
        const addBtn = el('add-trade-btn');
        if (addBtn) addBtn.addEventListener('click', openAddModal);

        const form = el('trade-form');
        if (form) form.addEventListener('submit', handleFormSubmit);

        const monthFilter = el('trading-month-filter');
        if (monthFilter) monthFilter.addEventListener('change', function () {
            selectedMonth = this.value;
            render();
        });

        const accountFilter = el('trading-account-filter');
        if (accountFilter) accountFilter.addEventListener('change', function () {
            setActiveAccountId(this.value);
            selectedMonth = 'all'; // reset month filter when switching accounts
            render();
        });

        const manageBtn = el('trading-manage-accounts-btn');
        if (manageBtn) manageBtn.addEventListener('click', openAccountManager);

        const acctAddBtn = el('account-manager-add-btn');
        if (acctAddBtn) acctAddBtn.addEventListener('click', handleAccountManagerAdd);

        const acctNewInput = el('account-manager-new');
        if (acctNewInput) {
            acctNewInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); handleAccountManagerAdd(); }
            });
        }

        const acctList = el('account-manager-list');
        if (acctList) acctList.addEventListener('click', handleAccountManagerListClick);

        const acctSaveBtn = el('account-manager-save-btn');
        if (acctSaveBtn) acctSaveBtn.addEventListener('click', handleAccountManagerSave);

        const statusField = el('trade-status');
        if (statusField) statusField.addEventListener('change', handleStatusChange);

        const tbody = el('trades-tbody');
        if (tbody) {
            tbody.addEventListener('click', function (e) {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-action');
                const tradeId = btn.getAttribute('data-id');
                if (action === 'edit') openEditModal(tradeId);
                else if (action === 'delete') deleteTrade(tradeId);
                else if (action === 'copy') openCopyTradeModal(tradeId);
            });
        }

        const copyConfirmBtn = el('copy-trade-confirm-btn');
        if (copyConfirmBtn) copyConfirmBtn.addEventListener('click', handleCopyTradeConfirm);
    }

    // ── Init ──────────────────────────────────────────────────────────

    function init() {
        ensureAccountsInitialized();
        bindEvents();
        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        init, render, loadTrades, saveTrades, calcPnL, calcStats,
        getActiveAccountId, getActiveCurrencyConfig, loadAccounts
    };
})();
