/**
 * AI Coach — Gemini-powered account-wide trade summaries.
 * Reads trades for the active account, sends to Google Gemini, renders
 * a summary in the trading-page sidebar.
 *
 * Security:
 *  - API key in localStorage (was_gemini_api_key), masked in UI.
 *  - Output is rendered with textContent — never innerHTML.
 *  - 60s timeout via AbortController.
 */
const AICoach = (function () {
    'use strict';

    const KEY_STORAGE = 'was_gemini_api_key';
    const MODEL_STORAGE = 'was_ai_model';
    const CHAT_STORAGE_PREFIX = 'was_ai_chat_'; // suffixed with accountId
    const DEFAULT_MODEL = 'gemini-2.5-flash';
    const MAX_TRADES_IN_PROMPT = 150;
    const MAX_NOTE_CHARS = 1500;
    const REQUEST_TIMEOUT_MS = 90000;

    // Preset prompts for quick-action chips (model auto-translates if notes are non-English)
    const QUICK_PROMPTS = {
        summary: "Give me a deep account-wide analysis. Follow your full section format.",
        emotions: "Focus only on the emotional and psychological themes you can detect from my notes. Quote specific phrases.",
        weekly: "What concrete things should I work on next week? Be specific and reference patterns from my actual trades."
    };

    let currentAccountId = null;     // tracked so we can reload chat on account switch
    let currentMessages = [];        // in-memory cache of active account's chat

    const SYSTEM_PROMPT = [
        "You are an expert trading coach performing a DEEP, PERSONALIZED analysis of a trader's complete journal.",
        "This is NOT a generic summary. Every observation must reference specific trades by date, pair, and direct quotes from the trader's notes.",
        "",
        "LANGUAGE RULES — CRITICAL:",
        "- Detect the dominant language of the trader's NOTES (not the field labels — those are always English).",
        "- Respond in that same language. If the notes are in Italian, your entire response must be in Italian.",
        "- Always quote the trader's notes VERBATIM in their original language. Never translate their words.",
        "",
        "ANALYSIS RULES — CRITICAL:",
        "- Read every single trade and every single note. Take your time.",
        "- Quote specific notes verbatim using > blockquotes. Reference exact dates and pairs.",
        "- Identify SPECIFIC patterns (e.g. 'EUR/USD shorts on Mondays after a loss', NOT 'sometimes you revenge trade').",
        "- Use the aggregate stats to back claims with numbers ('your last 6 GBP/JPY trades have a 17% win rate').",
        "- If you notice a contradiction between what the trader wrote and what they did, point it out.",
        "- Do NOT invent data. If something is unclear, say so.",
        "- Avoid generic advice that could apply to any trader. Every recommendation must reference observed behavior.",
        "",
        "OUTPUT FORMAT — use Markdown with these sections (translate the headings into the response language):",
        "",
        "## Riepilogo generale",
        "3-5 sentences capturing the trader's current state — their numbers, their mood from the notes, the dominant theme of the period.",
        "",
        "## Pattern ricorrenti negativi",
        "4-6 specific recurring mistakes. For each: name the pattern, describe the mechanism, then quote AT LEAST TWO specific trades/notes that demonstrate it (with date and pair). Use > blockquotes.",
        "",
        "## Cosa sta funzionando",
        "3-5 specific things that are working. Same format — quote specific wins and the notes that explain them.",
        "",
        "## Temi emotivi e psicologici",
        "Identify the emotional thread running through the notes. Are they fearful after losses? Overconfident after wins? Revenge trading? Quote the most revealing emotional phrases verbatim.",
        "",
        "## Setup e contesti più redditizi vs perdenti",
        "Break down by pair / day-of-week / direction (long vs short) / status — find the high-edge buckets and the bleeding ones. Use numbers.",
        "",
        "## Raccomandazioni concrete e testabili",
        "6-10 specific rules the trader could write on a sticky note. Each rule must reference a pattern you identified above. Format: a single rule, then a short reason citing the data.",
        "",
        "LENGTH: aim for 800-1500 words. Depth and specificity matter much more than brevity. The trader is paying attention to every word."
    ].join('\n');

    let inFlight = false;

    // ── Storage ─────────────────────────────────────────────────────────

    function loadKey() {
        try { return localStorage.getItem(KEY_STORAGE) || ''; }
        catch (e) { return ''; }
    }

    function saveKey(key) {
        if (!key) return;
        localStorage.setItem(KEY_STORAGE, key);
    }

    function clearKey() {
        localStorage.removeItem(KEY_STORAGE);
    }

    function loadModel() {
        try { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; }
        catch (e) { return DEFAULT_MODEL; }
    }

    function saveModel(m) {
        if (!m) return;
        localStorage.setItem(MODEL_STORAGE, m);
    }

    function chatKey(accountId) {
        return CHAT_STORAGE_PREFIX + (accountId || 'unknown');
    }

    function loadChat(accountId) {
        if (!accountId) return [];
        try {
            const raw = localStorage.getItem(chatKey(accountId));
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveChat(accountId, messages) {
        if (!accountId) return;
        try { localStorage.setItem(chatKey(accountId), JSON.stringify(messages)); }
        catch (e) { console.error('AICoach: chat save failed', e); }
    }

    function clearChat(accountId) {
        if (!accountId) return;
        localStorage.removeItem(chatKey(accountId));
    }

    function clearAllChats() {
        // Iterate localStorage keys directly so we catch chats from deleted accounts too
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(CHAT_STORAGE_PREFIX) === 0) toRemove.push(k);
        }
        for (let j = 0; j < toRemove.length; j++) localStorage.removeItem(toRemove[j]);
    }

    /** Returns ••••••••AIza1234-style display string, or '' if no key. */
    function maskedKey() {
        const k = loadKey();
        if (!k) return '';
        if (k.length <= 8) return '••••' + k.slice(-4);
        return '••••••••' + k.slice(-4);
    }

    // ── DOM helpers ────────────────────────────────────────────────────

    function $(id) { return document.getElementById(id); }

    /**
     * Append inline-formatted text to an element. Supports **bold** and *italic*
     * and `code` — NEVER uses innerHTML, builds via createTextNode + createElement
     * so a malicious response cannot inject scripts.
     */
    function appendInline(parent, raw) {
        // Tokenize: **bold**, *italic*, `code`, plain
        const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
        let last = 0;
        let m;
        while ((m = re.exec(raw)) !== null) {
            if (m.index > last) {
                parent.appendChild(document.createTextNode(raw.slice(last, m.index)));
            }
            const tok = m[0];
            if (tok.startsWith('**')) {
                const s = document.createElement('strong');
                s.textContent = tok.slice(2, -2);
                parent.appendChild(s);
            } else if (tok.startsWith('`')) {
                const c = document.createElement('code');
                c.textContent = tok.slice(1, -1);
                parent.appendChild(c);
            } else if (tok.startsWith('*')) {
                const e = document.createElement('em');
                e.textContent = tok.slice(1, -1);
                parent.appendChild(e);
            }
            last = m.index + tok.length;
        }
        if (last < raw.length) {
            parent.appendChild(document.createTextNode(raw.slice(last)));
        }
    }

    /**
     * Safe Markdown-to-DOM renderer. Supports: ##/### headings, > blockquotes,
     * - / * bullet lists, blank-line paragraphs, **bold**, *italic*, `code`.
     * All content nodes use textContent — no innerHTML anywhere.
     */
    function renderMarkdownToDom(text, container) {
        const lines = String(text || '').split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.replace(/^\s+/, '');

            // Empty line — separator
            if (!trimmed) { i++; continue; }

            // Heading 2: ## text
            if (/^##\s+/.test(trimmed) && !/^###\s+/.test(trimmed)) {
                const h = document.createElement('h3');
                appendInline(h, trimmed.replace(/^##\s+/, ''));
                container.appendChild(h);
                i++; continue;
            }
            // Heading 3: ### text
            if (/^###\s+/.test(trimmed)) {
                const h = document.createElement('h4');
                appendInline(h, trimmed.replace(/^###\s+/, ''));
                container.appendChild(h);
                i++; continue;
            }

            // Blockquote: collect consecutive > lines
            if (/^>\s?/.test(trimmed)) {
                const bq = document.createElement('blockquote');
                let buf = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                    buf.push(lines[i].replace(/^\s*>\s?/, ''));
                    i++;
                }
                appendInline(bq, buf.join(' '));
                container.appendChild(bq);
                continue;
            }

            // Bullet list: collect consecutive - or * lines
            if (/^[-*]\s+/.test(trimmed)) {
                const ul = document.createElement('ul');
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                    const li = document.createElement('li');
                    appendInline(li, lines[i].replace(/^\s*[-*]\s+/, ''));
                    ul.appendChild(li);
                    i++;
                }
                container.appendChild(ul);
                continue;
            }

            // Paragraph: collect non-empty, non-special lines
            const p = document.createElement('p');
            let pBuf = [];
            while (i < lines.length) {
                const ln = lines[i];
                const tr = ln.replace(/^\s+/, '');
                if (!tr) break;
                if (/^##\s+/.test(tr) || /^>\s?/.test(tr) || /^[-*]\s+/.test(tr)) break;
                pBuf.push(tr);
                i++;
            }
            appendInline(p, pBuf.join(' '));
            container.appendChild(p);
        }
    }

    function setStatus(text) {
        const s = $('ai-status');
        if (s) s.textContent = text || '';
    }

    function clearMessagesContainer() {
        const c = $('ai-messages');
        if (c) c.innerHTML = '';
    }

    function showEmptyPlaceholder(text) {
        const c = $('ai-messages');
        if (!c) return;
        c.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'ai-empty';
        div.textContent = text;
        c.appendChild(div);
    }

    function autoScrollMessages() {
        const c = $('ai-messages');
        if (c) c.scrollTop = c.scrollHeight;
    }

    /** Build a chat bubble. AI bubbles render Markdown safely via renderMarkdownToDom. */
    function renderBubble(role, content) {
        const wrap = document.createElement('div');
        wrap.className = 'ai-msg ai-msg-' + (role === 'user' ? 'user' : 'model');
        const body = document.createElement('div');
        body.className = 'ai-output-text';
        if (role === 'user') {
            // User messages are plain text — preserve newlines, no Markdown parsing
            body.style.whiteSpace = 'pre-wrap';
            body.textContent = content;
        } else {
            renderMarkdownToDom(content, body);
        }
        wrap.appendChild(body);
        return wrap;
    }

    function renderMessages() {
        const c = $('ai-messages');
        if (!c) return;
        if (!currentMessages || currentMessages.length === 0) {
            const hasKey = !!loadKey();
            showEmptyPlaceholder(hasKey
                ? 'No messages yet. Click a quick action or type below.'
                : 'Add a Gemini API key in settings, then start chatting.');
            return;
        }
        c.innerHTML = '';
        for (let i = 0; i < currentMessages.length; i++) {
            c.appendChild(renderBubble(currentMessages[i].role, currentMessages[i].content));
        }
        autoScrollMessages();
    }

    function appendMessageBubble(msg) {
        const c = $('ai-messages');
        if (!c) return;
        // If we're transitioning from empty placeholder, clear it first
        if (c.querySelector('.ai-empty')) c.innerHTML = '';
        c.appendChild(renderBubble(msg.role, msg.content));
        autoScrollMessages();
    }

    function appendErrorBubble(message) {
        const c = $('ai-messages');
        if (!c) return;
        if (c.querySelector('.ai-empty')) c.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'ai-error';
        div.textContent = message;
        c.appendChild(div);
        autoScrollMessages();
    }

    /** Sync the loaded chat to currentAccountId — call on init and on account switch. */
    function syncChatToActiveAccount() {
        if (typeof Trading === 'undefined' || !Trading.getActiveAccountId) return;
        const newId = Trading.getActiveAccountId();
        if (newId === currentAccountId) return; // no real switch
        currentAccountId = newId;
        currentMessages = loadChat(newId);
        renderMessages();
        refreshSendButton();
    }

    function refreshSendButton() {
        const btn = $('ai-send-btn');
        const input = $('ai-input');
        if (!btn) return;
        const hasKey = !!loadKey();
        const trades = collectActiveAccountTrades();
        const hasInput = !!(input && input.value && input.value.trim());

        if (inFlight) { btn.disabled = true; btn.title = 'Working...'; return; }
        if (!hasKey) { btn.disabled = true; btn.title = 'Add an API key in settings first'; return; }
        if (trades.length === 0) { btn.disabled = true; btn.title = 'No trades on this account yet'; return; }
        if (!hasInput) { btn.disabled = true; btn.title = 'Type a message'; return; }
        btn.disabled = false;
        btn.title = '';
    }

    // ── Trade selection ─────────────────────────────────────────────────

    function collectActiveAccountTrades() {
        if (typeof Trading === 'undefined') return [];
        const all = Trading.loadTrades();
        const activeId = Trading.getActiveAccountId();
        if (!activeId) return [];
        return all.filter(function (t) { return t.accountId === activeId; });
    }

    function findActiveAccountName() {
        if (typeof Trading === 'undefined') return '';
        const accounts = Trading.loadAccounts();
        const activeId = Trading.getActiveAccountId();
        for (let i = 0; i < accounts.length; i++) {
            if (accounts[i].id === activeId) return accounts[i].name;
        }
        return '';
    }

    // ── Prompt building ─────────────────────────────────────────────────

    function fmtNum(n, decimals) {
        if (n == null || isNaN(n)) return '--';
        return Number(n).toFixed(decimals == null ? 2 : decimals);
    }

    function truncate(s, max) {
        if (!s) return '';
        s = String(s);
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    /** Detect if notes are predominantly Italian/Spanish/French/German vs English. */
    function detectNotesLanguage(trades) {
        const allNotes = trades.map(function (t) { return t.notes || ''; }).join(' ').toLowerCase();
        if (!allNotes.trim()) return 'unknown';
        // Light heuristic: count common words from each language
        const buckets = {
            italian: ['il ', 'la ', 'che ', 'non ', 'ma ', 'però', 'troppo', 'perché', 'sono ', 'siamo', 'fatto', 'molto', 'questa', 'questo', 'avevo', 'devo'],
            spanish: ['el ', 'la ', 'que ', 'pero ', 'porque', 'estoy', 'estamos', 'mucho', 'esta ', 'este ', 'tenía'],
            french: ['le ', 'la ', 'que ', 'mais ', 'parce', 'beaucoup', 'cette', 'avais', 'était', 'avec '],
            german: ['der ', 'die ', 'das ', 'aber ', 'weil ', 'sehr ', 'diese', 'hatte', 'mit '],
            english: ['the ', 'and ', 'but ', 'because', 'too much', 'should ', 'this ', 'that ', 'with ', 'i had', 'i was']
        };
        let best = 'english', bestCount = 0;
        for (const lang in buckets) {
            let c = 0;
            for (let i = 0; i < buckets[lang].length; i++) {
                const w = buckets[lang][i];
                let pos = 0;
                while ((pos = allNotes.indexOf(w, pos)) !== -1) { c++; pos += w.length; }
            }
            if (c > bestCount) { bestCount = c; best = lang; }
        }
        return bestCount >= 3 ? best : 'unknown';
    }

    /** Build aggregate stats summary block — saves the model from doing math. */
    function buildStatsBlock(trades, currencyCfg) {
        if (typeof Trading === 'undefined' || !Trading.calcStats) return '';
        const s = Trading.calcStats(trades);
        const lines = [];
        lines.push('AGGREGATE STATS (already computed — use these for accuracy):');
        lines.push('- Total closed trades: ' + s.totalTrades);
        lines.push('- Total P&L: ' + currencyCfg.symbol + (s.totalPnL * currencyCfg.rate).toFixed(2));
        lines.push('- Win rate: ' + s.winRate);
        lines.push('- Profit factor: ' + s.profitFactor);
        lines.push('- Avg win: ' + currencyCfg.symbol + (s.avgWin * currencyCfg.rate).toFixed(2));
        lines.push('- Avg loss: -' + currencyCfg.symbol + (s.avgLoss * currencyCfg.rate).toFixed(2));
        if (s.bestTrade != null) lines.push('- Best trade: ' + currencyCfg.symbol + (s.bestTrade * currencyCfg.rate).toFixed(2));
        if (s.worstTrade != null) lines.push('- Worst trade: ' + currencyCfg.symbol + (s.worstTrade * currencyCfg.rate).toFixed(2));
        lines.push('- Current win streak: ' + s.currentWinStreak + ' | Current loss streak: ' + s.currentLossStreak);
        lines.push('- Max win streak: ' + s.maxWinStreak + ' | Max loss streak: ' + s.maxLossStreak);
        if (s.avgPlannedRR != null) lines.push('- Avg planned R:R: 1:' + s.avgPlannedRR.toFixed(2));
        if (s.avgActualRR != null) lines.push('- Avg actual R:R: ' + s.avgActualRR.toFixed(2) + 'R');
        if (s.breakevenWR != null) lines.push('- Breakeven win rate: ' + s.breakevenWR + '%');
        if (s.missedCount > 0) lines.push('- Missed-setup trades: ' + s.missedCount + ' (potential P&L: ' + currencyCfg.symbol + (s.missedPnL * currencyCfg.rate).toFixed(2) + ')');
        if (s.earlyCloseCount > 0) lines.push('- Early-closed trades: ' + s.earlyCloseCount + ' | Left on table (TP hit after exit): ' + currencyCfg.symbol + (s.leftOnTable * currencyCfg.rate).toFixed(2));

        // Per-pair breakdown
        const byPair = {};
        for (let i = 0; i < trades.length; i++) {
            const t = trades[i];
            if (t.status !== 'closed' && t.status !== 'early_close') continue;
            const k = t.ticker || '?';
            if (!byPair[k]) byPair[k] = { count: 0, wins: 0, pnl: 0 };
            byPair[k].count++;
            const p = Trading.calcPnL(t);
            if (p != null) {
                byPair[k].pnl += p;
                if (p > 0) byPair[k].wins++;
            }
        }
        const pairs = Object.keys(byPair).sort(function (a, b) { return byPair[b].count - byPair[a].count; });
        if (pairs.length > 0) {
            lines.push('');
            lines.push('Per-pair breakdown (closed + early_close only):');
            for (let p = 0; p < pairs.length; p++) {
                const pair = pairs[p];
                const r = byPair[pair];
                const wr = r.count > 0 ? Math.round((r.wins / r.count) * 100) : 0;
                lines.push('- ' + pair + ': ' + r.count + ' trades, ' + wr + '% WR, P&L ' + currencyCfg.symbol + (r.pnl * currencyCfg.rate).toFixed(2));
            }
        }

        // Per-day-of-week breakdown
        const byDow = [0,0,0,0,0,0,0].map(function () { return { count: 0, wins: 0, pnl: 0 }; });
        const dowNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        for (let i = 0; i < trades.length; i++) {
            const t = trades[i];
            if (t.status !== 'closed' && t.status !== 'early_close') continue;
            if (!t.date) continue;
            const d = new Date(t.date + 'T00:00:00');
            if (isNaN(d.getTime())) continue;
            const dow = d.getDay();
            byDow[dow].count++;
            const p = Trading.calcPnL(t);
            if (p != null) {
                byDow[dow].pnl += p;
                if (p > 0) byDow[dow].wins++;
            }
        }
        const dowLines = [];
        for (let d = 1; d <= 5; d++) {  // Mon-Fri only
            if (byDow[d].count > 0) {
                const wr = Math.round((byDow[d].wins / byDow[d].count) * 100);
                dowLines.push('- ' + dowNames[d] + ': ' + byDow[d].count + ' trades, ' + wr + '% WR, P&L ' + currencyCfg.symbol + (byDow[d].pnl * currencyCfg.rate).toFixed(2));
            }
        }
        if (dowLines.length > 0) {
            lines.push('');
            lines.push('Per-weekday breakdown:');
            lines.push.apply(lines, dowLines);
        }

        return lines.join('\n');
    }

    /**
     * Build the freshly-rebuilt context block sent as system_instruction every turn.
     * Always reflects the latest trade data — answers are never stale.
     */
    function buildSystemContext(trades, accountName, currencyCfg) {
        const sorted = trades.slice().sort(function (a, b) {
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            return 0;
        }).slice(0, MAX_TRADES_IN_PROMPT);

        const lang = detectNotesLanguage(trades);
        const lines = [];

        // Persona and behaviour rules (the existing SYSTEM_PROMPT constant)
        lines.push(SYSTEM_PROMPT);
        lines.push('');
        lines.push('=== TRADER CONTEXT (refreshed every message) ===');
        lines.push('Account: ' + (accountName || 'Unnamed'));
        lines.push('Display currency: ' + currencyCfg.code);
        lines.push('Total trades in account: ' + trades.length + (trades.length > sorted.length ? ' (most recent ' + sorted.length + ' shared below)' : ''));
        if (lang !== 'unknown' && lang !== 'english') {
            lines.push('Detected notes language: ' + lang.toUpperCase() + ' — respond in this language and quote notes verbatim.');
        }
        lines.push('');
        lines.push(buildStatsBlock(trades, currencyCfg));
        lines.push('');
        lines.push('FULL TRADE LIST (most recent first). Notes are the trader\'s own words — quote them verbatim:');

        for (let i = 0; i < sorted.length; i++) {
            const t = sorted[i];
            const isOpen = t.status === 'open';
            const isMissed = t.status === 'missed';
            const pnlUsd = (typeof Trading !== 'undefined' && Trading.calcPnL) ? Trading.calcPnL(t) : null;
            // Convert to display currency if we have a P&L
            const pnlDisplay = (pnlUsd != null) ? (pnlUsd * currencyCfg.rate) : null;

            // Planned R:R from SL/TP
            let plannedRR = null;
            if (t.slPrice != null && t.tpPrice != null) {
                const risk = t.type === 'long' ? (t.entryPrice - t.slPrice) : (t.slPrice - t.entryPrice);
                const reward = t.type === 'long' ? (t.tpPrice - t.entryPrice) : (t.entryPrice - t.tpPrice);
                if (risk > 0) plannedRR = Math.round((reward / risk) * 100) / 100;
            }
            // Actual R:R
            let actualRR = null;
            if (t.slPrice != null && t.exitPrice != null && (t.status === 'closed' || t.status === 'early_close')) {
                const risk = t.type === 'long' ? (t.entryPrice - t.slPrice) : (t.slPrice - t.entryPrice);
                const reward = t.type === 'long' ? (t.exitPrice - t.entryPrice) : (t.entryPrice - t.exitPrice);
                if (risk > 0) actualRR = Math.round((reward / risk) * 100) / 100;
            }

            const parts = [];
            parts.push((i + 1) + '.');
            parts.push(t.date || '?');
            parts.push((t.ticker || '?') + ' ' + (t.type || ''));
            parts.push('status=' + t.status);
            if (plannedRR != null) parts.push('plannedRR=1:' + fmtNum(plannedRR));
            if (actualRR != null) parts.push('actualRR=' + fmtNum(actualRR) + 'R');
            if (pnlDisplay != null) {
                parts.push('pnl=' + currencyCfg.symbol + fmtNum(pnlDisplay));
            } else if (isOpen) {
                parts.push('pnl=open');
            } else if (isMissed) {
                parts.push('pnl=missed-setup');
            }
            if (t.status === 'early_close' && t.tpHitAfterExit === true) {
                parts.push('note=closed-before-TP-which-was-hit');
            }
            lines.push(parts.join(' | '));
            if (t.notes) {
                lines.push('   notes: ' + truncate(t.notes, MAX_NOTE_CHARS));
            }
        }

        return lines.join('\n');
    }

    // ── Gemini API call ─────────────────────────────────────────────────

    async function callGemini(systemInstruction, contents, apiKey, model) {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);

        const body = {
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: contents,
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 4000,
                topP: 0.95
            }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (e) {
            clearTimeout(timeoutId);
            if (e && e.name === 'AbortError') {
                throw new Error('Request timed out after ' + (REQUEST_TIMEOUT_MS / 1000) + 's.');
            }
            throw new Error('Network error reaching Gemini. Check your internet connection.');
        }
        clearTimeout(timeoutId);

        if (!res.ok) {
            // Map common HTTP errors to friendly messages — never log the key
            if (res.status === 400) throw new Error('400 Bad Request: the prompt was rejected by Gemini.');
            if (res.status === 401 || res.status === 403) {
                throw new Error(res.status + ': API key invalid or lacking permission. Check your key in settings.');
            }
            if (res.status === 429) throw new Error('429 Rate limit hit. Wait a minute and try again.');
            if (res.status >= 500) throw new Error(res.status + ': Gemini server error. Try again shortly.');
            throw new Error('Unexpected response status ' + res.status + '.');
        }

        let data;
        try {
            data = await res.json();
        } catch (e) {
            throw new Error('Could not parse Gemini response.');
        }

        // Extract first candidate's text
        const candidates = data && data.candidates;
        if (!candidates || !candidates.length) {
            throw new Error('Gemini returned no candidates. The request may have been blocked by safety filters.');
        }
        const parts = candidates[0].content && candidates[0].content.parts;
        if (!parts || !parts.length) {
            throw new Error('Gemini returned an empty response.');
        }
        // Concatenate all text parts
        let out = '';
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].text) out += parts[i].text;
        }
        if (!out) throw new Error('Gemini response had no text content.');
        return out;
    }

    // ── Chat orchestrator ─────────────────────────────────────────────

    /** Convert persisted messages into the contents array Gemini expects. */
    function messagesToContents(messages) {
        const out = [];
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (!m || !m.content) continue;
            out.push({
                role: m.role === 'model' ? 'model' : 'user',
                parts: [{ text: m.content }]
            });
        }
        return out;
    }

    async function sendMessage(text) {
        if (inFlight) return;
        const trimmed = (text || '').trim();
        if (!trimmed) return;

        const apiKey = loadKey();
        if (!apiKey) {
            appendErrorBubble('No API key set. Click the gear icon to add one.');
            return;
        }
        const trades = collectActiveAccountTrades();
        if (trades.length === 0) {
            appendErrorBubble('No trades on this account to analyze.');
            return;
        }

        // Make sure we have the right account context loaded
        syncChatToActiveAccount();

        // Append user turn (in-memory + persisted + UI)
        const userMsg = { role: 'user', content: trimmed, timestamp: new Date().toISOString() };
        currentMessages.push(userMsg);
        saveChat(currentAccountId, currentMessages);
        appendMessageBubble(userMsg);

        // Build the freshly-rebuilt context (includes latest trades + stats)
        const cfg = (typeof Trading !== 'undefined' && Trading.getActiveCurrencyConfig)
            ? Trading.getActiveCurrencyConfig()
            : { code: 'USD', symbol: '$', rate: 1 };
        const accountName = findActiveAccountName();
        const systemInstruction = buildSystemContext(trades, accountName, cfg);
        const contents = messagesToContents(currentMessages);

        inFlight = true;
        setStatus('Thinking…');
        refreshSendButton();

        try {
            const replyText = await callGemini(systemInstruction, contents, apiKey, loadModel());
            const aiMsg = { role: 'model', content: replyText, timestamp: new Date().toISOString() };
            currentMessages.push(aiMsg);
            saveChat(currentAccountId, currentMessages);
            appendMessageBubble(aiMsg);
            setStatus('');
        } catch (e) {
            setStatus('');
            // Roll back the user message so they can retry without duplication?
            // Keep it visible — the user wrote it and may want to re-send. Just append error bubble.
            appendErrorBubble(e && e.message ? e.message : 'Unknown error.');
        } finally {
            inFlight = false;
            refreshSendButton();
        }
    }

    function handleSendClick() {
        const input = $('ai-input');
        if (!input) return;
        const text = input.value;
        if (!text.trim()) return;
        input.value = '';
        refreshSendButton();
        sendMessage(text);
    }

    function handleQuickAction(promptKey) {
        const preset = QUICK_PROMPTS[promptKey];
        if (!preset) return;
        // Send directly — don't pre-fill the input, the chip's label is enough context
        sendMessage(preset);
    }

    function handleClearChatClick() {
        syncChatToActiveAccount(); // ensure we know which account
        if (!currentAccountId) return;
        if (currentMessages.length === 0) return;
        if (!confirm('Clear the chat for this account? This cannot be undone.')) return;
        clearChat(currentAccountId);
        currentMessages = [];
        renderMessages();
        if (typeof App !== 'undefined' && App.toast) App.toast('Chat cleared for this account.', 'info');
    }

    function handleClearAllChatsClick() {
        if (!confirm('Erase chat history across ALL accounts? This cannot be undone.')) return;
        clearAllChats();
        currentMessages = [];
        renderMessages();
        if (typeof App !== 'undefined') {
            if (App.toast) App.toast('All chats cleared.', 'info');
            if (App.closeModal) App.closeModal('ai-settings-modal');
        }
    }

    // ── Settings modal ─────────────────────────────────────────────────

    function openSettings() {
        const input = $('ai-key-input');
        const select = $('ai-model-select');
        const status = $('ai-key-status');
        if (input) {
            input.value = '';
            input.type = 'password';
            input.placeholder = loadKey() ? maskedKey() : 'AIza...';
        }
        if (select) select.value = loadModel();
        if (status) status.textContent = loadKey() ? 'A key is currently saved (' + maskedKey() + ').' : 'No key saved yet.';
        if (typeof App !== 'undefined' && App.showModal) App.showModal('ai-settings-modal');
    }

    function handleSaveKey() {
        const input = $('ai-key-input');
        const select = $('ai-model-select');
        if (!input) return;
        const val = (input.value || '').trim();
        // Only save a new key if user actually typed something — otherwise just save the model
        if (val) {
            // Light sanity check: Gemini keys start with "AIza" and are ~39 chars
            if (val.length < 20) {
                if (typeof App !== 'undefined' && App.toast) App.toast('That doesn\'t look like a valid API key.', 'error');
                return;
            }
            saveKey(val);
        }
        if (select) saveModel(select.value);
        if (typeof App !== 'undefined') {
            if (App.toast) App.toast('AI settings saved.', 'success');
            if (App.closeModal) App.closeModal('ai-settings-modal');
        }
        refreshSendButton();
        renderMessages(); // refresh empty placeholder text now that key state changed
        // Reset placeholder for the just-cleared input
        if (input) input.value = '';
    }

    function handleClearKey() {
        if (!confirm('Remove the saved API key from this browser?')) return;
        clearKey();
        const input = $('ai-key-input');
        const status = $('ai-key-status');
        if (input) { input.value = ''; input.placeholder = 'AIza...'; }
        if (status) status.textContent = 'No key saved yet.';
        if (typeof App !== 'undefined' && App.toast) App.toast('API key cleared.', 'info');
        refreshSendButton();
        renderMessages(); // updates empty placeholder when no chat
    }

    function handleToggleVisibility() {
        const input = $('ai-key-input');
        if (!input) return;
        input.type = (input.type === 'password') ? 'text' : 'password';
    }

    // ── Init ───────────────────────────────────────────────────────────

    function init() {
        // Settings modal
        const settingsBtn = $('ai-settings-btn');
        if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

        const saveBtn = $('ai-key-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', handleSaveKey);

        const clearBtn = $('ai-key-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', handleClearKey);

        const toggleBtn = $('ai-key-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', handleToggleVisibility);

        const clearAllChatsBtn = $('ai-clear-all-chats-btn');
        if (clearAllChatsBtn) clearAllChatsBtn.addEventListener('click', handleClearAllChatsClick);

        // Chat controls
        const sendBtn = $('ai-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', handleSendClick);

        const clearChatBtn = $('ai-clear-chat-btn');
        if (clearChatBtn) clearChatBtn.addEventListener('click', handleClearChatClick);

        const input = $('ai-input');
        if (input) {
            input.addEventListener('input', refreshSendButton);
            input.addEventListener('keydown', function (e) {
                // Enter sends; Shift+Enter inserts newline (default behaviour)
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendClick();
                }
            });
        }

        // Quick-action chips
        const chips = document.querySelectorAll('.ai-quick-actions .ai-chip');
        for (let i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () {
                const k = this.getAttribute('data-prompt');
                handleQuickAction(k);
            });
        }

        // Account-switch + trade-changes: keep chat in sync, refresh button state
        document.addEventListener('trading:trades-changed', function () {
            syncChatToActiveAccount(); // swaps chat history if account switched
            refreshSendButton();
        });

        // Initial paint
        syncChatToActiveAccount();
        refreshSendButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { init, sendMessage };
})();
