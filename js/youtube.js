/**
 * YouTube Tracker — No API key required
 * RSS feeds via RSS2JSON (CORS-friendly).
 * Handle resolution: RSS2JSON user feed → allorigins JSON → CORS proxy chain.
 */
var YouTube = (function () {
    'use strict';

    // Inject channel stats CSS
    (function () {
        var style = document.createElement('style');
        style.textContent = ''
            + '.channel-stats-section {'
            + '  margin: 8px 0 4px 0;'
            + '  padding: 8px 10px;'
            + '  border-top: 1px solid rgba(128,128,128,0.15);'
            + '  display: flex;'
            + '  flex-direction: column;'
            + '  gap: 4px;'
            + '}'
            + '.channel-stat-row {'
            + '  display: flex;'
            + '  align-items: center;'
            + '  gap: 6px;'
            + '  font-size: 0.75rem;'
            + '  color: #888;'
            + '  line-height: 1.4;'
            + '}'
            + '.channel-stat-icon {'
            + '  flex-shrink: 0;'
            + '  width: 16px;'
            + '  text-align: center;'
            + '  font-size: 0.8rem;'
            + '}'
            + '.channel-stat-text {'
            + '  white-space: nowrap;'
            + '  overflow: hidden;'
            + '  text-overflow: ellipsis;'
            + '}';
        document.head.appendChild(style);
    })();

    var STORAGE_KEY = 'was_yt_channels';
    var FETCH_TIMEOUT = 12000;
    var channels = [];

    function el(id) { return document.getElementById(id); }

    // ── Persistence ────────────────────────────────────────────────────

    function loadChannels() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            channels = data ? JSON.parse(data) : [];
        } catch (e) { channels = []; }
    }

    function saveChannels() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
    }

    // ── Stats Persistence ────────────────────────────────────────────

    var STATS_KEY = 'was_yt_channel_stats';
    var statsChart = null;

    function loadAllStats() {
        try { var raw = localStorage.getItem(STATS_KEY); return raw ? JSON.parse(raw) : {}; }
        catch (e) { return {}; }
    }

    function saveAllStats(allStats) {
        localStorage.setItem(STATS_KEY, JSON.stringify(allStats));
    }

    function getChannelStats(channelId) {
        var all = loadAllStats();
        return all[channelId] || [];
    }

    function addChannelStat(channelId, entry) {
        var all = loadAllStats();
        if (!all[channelId]) all[channelId] = [];
        // Remove existing entry for same date
        all[channelId] = all[channelId].filter(function(e) { return e.date !== entry.date; });
        all[channelId].push(entry);
        // Sort by date
        all[channelId].sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        saveAllStats(all);
    }

    // ── Stats Modal ──────────────────────────────────────────────────

    function openStatsModal(channelId) {
        var channel = channels.find(function(c) { return c.channelId === channelId || c.id === channelId; });
        if (!channel) return;

        var titleEl = document.getElementById('yt-stats-modal-title');
        if (titleEl) titleEl.textContent = 'Log Stats \u2014 ' + channel.name;

        var cidEl = document.getElementById('yt-stats-channel-id');
        if (cidEl) cidEl.value = channel.channelId;

        // Set default date to today
        var dateEl = document.getElementById('yt-stats-date');
        if (dateEl) {
            var d = new Date();
            dateEl.value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        }

        // Clear form fields
        var fields = ['yt-stats-views', 'yt-stats-subs', 'yt-stats-impressions', 'yt-stats-watch-hours'];
        for (var i = 0; i < fields.length; i++) {
            var f = document.getElementById(fields[i]);
            if (f) f.value = '';
        }

        // Pre-fill with latest stats if they exist
        var stats = getChannelStats(channel.channelId);
        if (stats.length > 0) {
            var latest = stats[stats.length - 1];
            var viewsEl = document.getElementById('yt-stats-views');
            var subsEl = document.getElementById('yt-stats-subs');
            var impEl = document.getElementById('yt-stats-impressions');
            var whEl = document.getElementById('yt-stats-watch-hours');
            if (viewsEl && latest.views != null) viewsEl.placeholder = 'Last: ' + formatNumber(latest.views);
            if (subsEl && latest.subscribers != null) subsEl.placeholder = 'Last: ' + formatNumber(latest.subscribers);
            if (impEl && latest.impressions != null) impEl.placeholder = 'Last: ' + formatNumber(latest.impressions);
            if (whEl && latest.watchHours != null) whEl.placeholder = 'Last: ' + latest.watchHours;
        }

        renderStatsChart(channel.channelId);

        if (typeof App !== 'undefined' && App.showModal) App.showModal('yt-stats-modal');
    }

    function formatNumber(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
    }

    function handleStatsFormSubmit(e) {
        e.preventDefault();
        var channelId = document.getElementById('yt-stats-channel-id').value;
        var date = document.getElementById('yt-stats-date').value;
        if (!channelId || !date) return;

        var views = document.getElementById('yt-stats-views').value;
        var subs = document.getElementById('yt-stats-subs').value;
        var impressions = document.getElementById('yt-stats-impressions').value;
        var watchHours = document.getElementById('yt-stats-watch-hours').value;

        var entry = { date: date };
        if (views !== '') entry.views = parseInt(views, 10);
        if (subs !== '') entry.subscribers = parseInt(subs, 10);
        if (impressions !== '') entry.impressions = parseInt(impressions, 10);
        if (watchHours !== '') entry.watchHours = parseFloat(watchHours);

        addChannelStat(channelId, entry);

        if (typeof App !== 'undefined' && App.toast) App.toast('Stats saved!', 'success');

        renderStatsChart(channelId);
        render(); // re-render channel cards to show updated stats
    }

    function renderStatsChart(channelId) {
        var container = document.getElementById('yt-stats-chart-card');
        var canvas = document.getElementById('yt-stats-chart');
        if (!container || !canvas) return;

        var stats = getChannelStats(channelId);
        if (stats.length < 2) { container.style.display = 'none'; return; }

        container.style.display = '';

        if (statsChart) { statsChart.destroy(); statsChart = null; }

        var labels = stats.map(function(s) {
            var parts = s.date.split('-');
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return months[parseInt(parts[1],10)-1] + ' ' + parseInt(parts[2],10);
        });

        var datasets = [];

        // Check which data series exist
        var hasViews = stats.some(function(s) { return s.views != null; });
        var hasSubs = stats.some(function(s) { return s.subscribers != null; });
        var hasImpressions = stats.some(function(s) { return s.impressions != null; });
        var hasWH = stats.some(function(s) { return s.watchHours != null; });

        if (hasViews) datasets.push({
            label: 'Views', data: stats.map(function(s) { return s.views || 0; }),
            borderColor: '#7c5cfc', backgroundColor: 'rgba(124,92,252,0.08)',
            fill: true, tension: 0.3, borderWidth: 2, pointRadius: 3
        });
        if (hasSubs) datasets.push({
            label: 'Subscribers', data: stats.map(function(s) { return s.subscribers || 0; }),
            borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.08)',
            fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3
        });
        if (hasImpressions) datasets.push({
            label: 'Impressions', data: stats.map(function(s) { return s.impressions || 0; }),
            borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.08)',
            fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3, hidden: true
        });
        if (hasWH) datasets.push({
            label: 'Watch Hours', data: stats.map(function(s) { return s.watchHours || 0; }),
            borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.08)',
            fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3, hidden: true
        });

        if (datasets.length === 0) { container.style.display = 'none'; return; }

        statsChart = new Chart(canvas, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                scales: {
                    x: { grid: { color: '#252540' }, ticks: { color: '#5a5a78', maxTicksLimit: 8 } },
                    y: { grid: { color: '#252540' }, ticks: { color: '#9898b0', callback: function(v) {
                        if (v >= 1000000) return (v/1000000).toFixed(1) + 'M';
                        if (v >= 1000) return (v/1000).toFixed(0) + 'K';
                        return v;
                    }}}
                },
                plugins: { legend: { labels: { color: '#9898b0', usePointStyle: true, pointStyle: 'circle' } } }
            }
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────

    function timeAgo(dateStr) {
        if (!dateStr) return 'never';
        var now = new Date();
        var then = new Date(dateStr);
        var diffMs = now - then;
        var diffDays = Math.floor(diffMs / 86400000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return '1d ago';
        if (diffDays < 7) return diffDays + 'd ago';
        if (diffDays < 30) return Math.floor(diffDays / 7) + 'w ago';
        if (diffDays < 365) return Math.floor(diffDays / 30) + 'mo ago';
        return Math.floor(diffDays / 365) + 'y ago';
    }

    function formatVideoDate(dateStr) {
        if (!dateStr) return '';
        var d = new Date(dateStr);
        var diff = Date.now() - d.getTime();
        var days = Math.floor(diff / 86400000);
        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return days + ' days ago';
        if (days < 30) return Math.floor(days / 7) + 'w ago';
        if (days < 365) return Math.floor(days / 30) + 'mo ago';
        return Math.floor(days / 365) + 'y ago';
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function timeAgoLong(dateStr) {
        if (!dateStr) return 'unknown';
        var diff = Date.now() - new Date(dateStr).getTime();
        var sec = Math.floor(diff / 1000);
        if (sec < 60) return 'just now';
        var min = Math.floor(sec / 60);
        if (min < 60) return min === 1 ? '1 minute ago' : min + ' minutes ago';
        var hr = Math.floor(min / 60);
        if (hr < 24) return hr === 1 ? '1 hour ago' : hr + ' hours ago';
        var d = Math.floor(hr / 24);
        if (d < 7) return d === 1 ? '1 day ago' : d + ' days ago';
        var w = Math.floor(d / 7);
        if (d < 30) return w === 1 ? '1 week ago' : w + ' weeks ago';
        var mo = Math.floor(d / 30);
        if (d < 365) return mo === 1 ? '1 month ago' : mo + ' months ago';
        var y = Math.floor(d / 365);
        return y === 1 ? '1 year ago' : y + ' years ago';
    }

    function formatDateNice(dateStr) {
        if (!dateStr) return 'unknown';
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var d = new Date(dateStr);
        return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    }

    function truncateStr(str, max) {
        if (!str) return '';
        max = max || 50;
        if (str.length <= max) return str;
        return str.substring(0, max) + '\u2026';
    }

    function calcUploadFrequency(videos) {
        if (videos.length < 2) return '--';
        var dates = videos.map(function(v) { return new Date(v.published).getTime(); }).sort(function(a, b) { return a - b; });
        var totalDays = (dates[dates.length - 1] - dates[0]) / 86400000;
        var avgDays = Math.round(totalDays / (dates.length - 1));
        if (avgDays <= 1) return '~daily';
        if (avgDays <= 6) return '~' + avgDays + 'd';
        if (avgDays <= 13) return '~1w';
        if (avgDays <= 27) return '~' + Math.round(avgDays / 7) + 'w';
        return '~' + Math.round(avgDays / 30) + 'mo';
    }

    function getActivityStatus(videos) {
        if (!videos.length) return { dot: 'dot-inactive', label: 'No data' };
        var latest = new Date(videos[0].published);
        var diffDays = Math.floor((new Date() - latest) / 86400000);
        if (diffDays < 3) return { dot: 'dot-active', label: 'Active' };
        if (diffDays < 14) return { dot: 'dot-regular', label: 'Regular' };
        return { dot: 'dot-inactive', label: 'Inactive' };
    }

    function formatDateRange(videos) {
        if (videos.length < 2) return '';
        var dates = videos.map(function(v) { return new Date(v.published); }).sort(function(a, b) { return a - b; });
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var first = dates[0];
        var last = dates[dates.length - 1];
        return months[first.getMonth()] + ' ' + first.getDate() + ' - ' + months[last.getMonth()] + ' ' + last.getDate();
    }

    // ── Fetch with timeout ────────────────────────────────────────────

    function fetchT(url, ms) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, ms || FETCH_TIMEOUT);
        return fetch(url, { signal: controller.signal })
            .then(function (r) { clearTimeout(timer); return r; })
            .catch(function (e) { clearTimeout(timer); throw e; });
    }

    // ── Input Parsing ─────────────────────────────────────────────────

    function parseChannelInput(input) {
        input = input.trim();
        if (!input) return null;

        if (/^UC[\w-]{22}$/.test(input)) return { type: 'id', value: input };
        if (/^@[\w.-]+$/.test(input)) return { type: 'handle', value: input };

        try {
            var url = input.indexOf('http') === 0 ? new URL(input) : new URL('https://' + input);
            if (url.hostname.indexOf('youtube.com') !== -1 || url.hostname.indexOf('youtu.be') !== -1) {
                var path = url.pathname;
                var chMatch = path.match(/\/channel\/(UC[\w-]{22})/);
                if (chMatch) return { type: 'id', value: chMatch[1] };
                var handleMatch = path.match(/\/@([\w.-]+)/);
                if (handleMatch) return { type: 'handle', value: '@' + handleMatch[1] };
                var customMatch = path.match(/\/(c|user)\/([\w.-]+)/);
                if (customMatch) return { type: 'handle', value: '@' + customMatch[2] };
            }
        } catch (e) {}

        if (/^[\w.-]+$/.test(input)) return { type: 'handle', value: '@' + input };
        return { type: 'handle', value: input };
    }

    // ── Extract channel ID from HTML ──────────────────────────────────

    function extractChannelId(html) {
        var patterns = [
            /"channelId"\s*:\s*"(UC[\w-]{22})"/,
            /"externalId"\s*:\s*"(UC[\w-]{22})"/,
            /channel_id=(UC[\w-]{22})/,
            /<link[^>]+href="[^"]*channel_id=(UC[\w-]{22})"/,
            /<link[^>]+rel="canonical"[^>]+href="[^"]*\/channel\/(UC[\w-]{22})"/,
            /\/channel\/(UC[\w-]{22})/
        ];
        for (var i = 0; i < patterns.length; i++) {
            var match = html.match(patterns[i]);
            if (match) return match[1];
        }
        return null;
    }

    // ── Handle Resolution: 3 methods chained ──────────────────────────

    /**
     * Method 1: RSS2JSON with ?user= parameter.
     * Works when @handle matches the legacy YouTube username.
     * No CORS proxy needed — RSS2JSON has proper CORS headers.
     */
    function resolveViaRSS2JSON(handle) {
        var rssUrl = 'https://www.youtube.com/feeds/videos.xml?user=' + encodeURIComponent(handle);
        var apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);

        return fetchT(apiUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (data.status !== 'ok') throw new Error('Feed not found');
                // feed.link is typically "https://www.youtube.com/channel/UCxxx"
                var link = data.feed && data.feed.link;
                if (link) {
                    var m = link.match(/\/channel\/(UC[\w-]{22})/);
                    if (m) return m[1];
                }
                throw new Error('No channel ID in feed link');
            });
    }

    /**
     * Method 2: allorigins JSON endpoint — wraps response in {"contents":"..."}.
     * More reliable than the /raw endpoint because response is always valid JSON.
     */
    function resolveViaAllOrigins(handle) {
        var pageUrl = 'https://www.youtube.com/@' + encodeURIComponent(handle);
        var apiUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(pageUrl);

        return fetchT(apiUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data.contents) throw new Error('Empty contents');
                var id = extractChannelId(data.contents);
                if (id) return id;
                throw new Error('Channel ID not found');
            });
    }

    /**
     * Method 3: Raw CORS proxies as last resort.
     */
    function resolveViaCORSProxy(handle, idx) {
        var proxies = [
            'https://corsproxy.io/?',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        idx = idx || 0;
        if (idx >= proxies.length) return Promise.reject(new Error('All proxies failed'));

        var pageUrl = 'https://www.youtube.com/@' + encodeURIComponent(handle);
        var proxyUrl = proxies[idx] + encodeURIComponent(pageUrl);

        return fetchT(proxyUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(function (html) {
                var id = extractChannelId(html);
                if (id) return id;
                throw new Error('Not found');
            })
            .catch(function () {
                return resolveViaCORSProxy(handle, idx + 1);
            });
    }

    /**
     * Main resolver — chains all 3 methods.
     */
    function resolveHandle(handle) {
        var clean = handle.replace(/^@/, '');

        return resolveViaRSS2JSON(clean)
            .catch(function () { return resolveViaAllOrigins(clean); })
            .catch(function () { return resolveViaCORSProxy(clean); })
            .catch(function () {
                throw new Error(
                    'Could not resolve @' + clean
                    + '. Go to the channel on YouTube, copy the URL from your browser, and paste it here.'
                );
            });
    }

    // ── Auto-scrape channel stats ───────────────────────────────────

    /**
     * Fetch video view counts from returnyoutubedislikeapi.com (free, no key).
     * Returns { viewCount, likes, dislikes } or null on failure.
     */
    function fetchVideoStats(videoId) {
        return fetchT('https://returnyoutubedislikeapi.com/votes?videoId=' + videoId, 8000)
            .then(function (res) { return res.ok ? res.json() : null; })
            .catch(function () { return null; });
    }

    /**
     * Extract subscriber count from YouTube channel page HTML.
     * Looks for the subscriberCountText pattern in ytInitialData.
     */
    function extractSubCount(html) {
        // Pattern: "subscriberCountText":{"simpleText":"12.3K subscribers"}
        var m = html.match(/"subscriberCountText"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"/);
        if (m) return parseSubText(m[1]);
        // Fallback: "subscriberCountText":{"accessibility":...,"simpleText":"..."}
        var m2 = html.match(/"subscriberCountText"[^}]*"simpleText"\s*:\s*"([^"]+)"/);
        if (m2) return parseSubText(m2[1]);
        return null;
    }

    function parseSubText(text) {
        // "12.3K subscribers" -> 12300, "1.5M subscribers" -> 1500000
        var clean = text.replace(/\s*subscribers?/i, '').trim();
        var num = parseFloat(clean);
        if (isNaN(num)) return null;
        if (/K$/i.test(clean)) return Math.round(num * 1000);
        if (/M$/i.test(clean)) return Math.round(num * 1000000);
        if (/B$/i.test(clean)) return Math.round(num * 1000000000);
        return Math.round(num);
    }

    /**
     * Fetch subscriber count by scraping the channel page via CORS proxy.
     */
    function fetchSubCount(channelId) {
        var pageUrl = 'https://www.youtube.com/channel/' + channelId;
        var apiUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(pageUrl);

        return fetchT(apiUrl, 10000)
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (!data || !data.contents) return null;
                return extractSubCount(data.contents);
            })
            .catch(function () { return null; });
    }

    /**
     * Auto-fetch all stats for a channel: video views + subscriber count.
     * Returns { views (total), subscribers, videoViews: [{videoId, views, likes}] }
     */
    function autoFetchStats(channelId, videos) {
        var videoIds = [];
        if (videos) {
            for (var i = 0; i < Math.min(videos.length, 8); i++) {
                if (videos[i].videoId) videoIds.push(videos[i].videoId);
            }
        }

        // Fetch video stats and sub count in parallel
        var videoPromises = videoIds.map(function (vid) { return fetchVideoStats(vid); });
        var subPromise = fetchSubCount(channelId);

        return Promise.all([Promise.all(videoPromises), subPromise])
            .then(function (results) {
                var videoStats = results[0];
                var subCount = results[1];

                var totalViews = 0;
                var videoViews = [];
                for (var i = 0; i < videoStats.length; i++) {
                    if (videoStats[i] && videoStats[i].viewCount != null) {
                        totalViews += videoStats[i].viewCount;
                        videoViews.push({
                            videoId: videoIds[i],
                            views: videoStats[i].viewCount,
                            likes: videoStats[i].likes || 0,
                            dislikes: videoStats[i].dislikes || 0
                        });
                    }
                }

                return {
                    totalViews: totalViews > 0 ? totalViews : null,
                    subscribers: subCount,
                    videoViews: videoViews
                };
            })
            .catch(function () {
                return { totalViews: null, subscribers: null, videoViews: [] };
            });
    }

    /**
     * Auto-log stats entry for a channel after fetching.
     * Only logs if we got at least some data.
     */
    function autoLogStats(channelId, autoStats) {
        if (!autoStats.totalViews && !autoStats.subscribers) return;
        var d = new Date();
        var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var entry = { date: dateStr, auto: true };
        if (autoStats.totalViews) entry.views = autoStats.totalViews;
        if (autoStats.subscribers) entry.subscribers = autoStats.subscribers;
        addChannelStat(channelId, entry);
    }

    // ── Fetch RSS via RSS2JSON (primary) ─────────────────────────────

    function fetchRSSJSON(channelId) {
        var rssUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
        var apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(rssUrl);

        return fetchT(apiUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (data.status !== 'ok') throw new Error('RSS2JSON error');

                var channelName = data.feed ? data.feed.title : 'Unknown Channel';
                var videos = [];
                var items = data.items || [];

                for (var i = 0; i < Math.min(items.length, 8); i++) {
                    var item = items[i];
                    var videoId = '';
                    if (item.link) {
                        var m = item.link.match(/[?&]v=([\w-]+)/);
                        if (m) videoId = m[1];
                    }
                    if (!videoId && item.guid) {
                        var gm = item.guid.match(/video:([\w-]+)/);
                        if (gm) videoId = gm[1];
                    }
                    videos.push({
                        videoId: videoId,
                        title: item.title || '',
                        published: item.pubDate || '',
                        thumbnail: videoId
                            ? 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg'
                            : (item.thumbnail || '')
                    });
                }

                return { channelId: channelId, name: channelName, videos: videos };
            });
    }

    // ── Fetch RSS via allorigins JSON + XML parse (fallback) ─────────

    function fetchRSSXML(channelId) {
        var rssUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId;
        var apiUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(rssUrl);

        return fetchT(apiUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                if (!data.contents) throw new Error('Empty');
                var parser = new DOMParser();
                var doc = parser.parseFromString(data.contents, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

                var titleEl = doc.querySelector('feed > title');
                var channelName = titleEl ? titleEl.textContent : 'Unknown Channel';
                var entries = doc.querySelectorAll('entry');
                var videos = [];

                for (var i = 0; i < Math.min(entries.length, 8); i++) {
                    var entry = entries[i];
                    var videoIdEl = entry.getElementsByTagNameNS(
                        'http://www.youtube.com/xml/schemas/2015', 'videoId')[0];
                    var videoId = videoIdEl ? videoIdEl.textContent : '';
                    var titleNode = entry.querySelector('title');
                    var publishedEl = entry.querySelector('published');
                    videos.push({
                        videoId: videoId,
                        title: titleNode ? titleNode.textContent : '',
                        published: publishedEl ? publishedEl.textContent : '',
                        thumbnail: videoId ? 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg' : ''
                    });
                }

                return { channelId: channelId, name: channelName, videos: videos };
            });
    }

    // ── Combined fetch: RSS2JSON → allorigins XML fallback ────────────

    function fetchRSS(channelId) {
        return fetchRSSJSON(channelId).catch(function () {
            return fetchRSSXML(channelId);
        });
    }

    // ── Channel Management ────────────────────────────────────────────

    function setLoading(btn, loading) {
        if (!btn) return;
        btn.disabled = loading;
        if (loading) {
            btn.dataset.origText = btn.textContent;
            btn.textContent = 'Loading\u2026';
        } else {
            btn.textContent = btn.dataset.origText || btn.textContent;
        }
    }

    function addChannel(input) {
        var parsed = parseChannelInput(input);
        if (!parsed) {
            App.toast('Please enter a valid channel URL, @handle, or ID', 'error');
            return;
        }

        var addBtn = el('add-channel-btn');
        setLoading(addBtn, true);

        var promise = parsed.type === 'id'
            ? Promise.resolve(parsed.value)
            : resolveHandle(parsed.value);

        promise
            .then(function (channelId) {
                var exists = channels.some(function (ch) { return ch.channelId === channelId; });
                if (exists) {
                    App.toast('Channel already tracked', 'error');
                    return Promise.reject({ handled: true });
                }
                return fetchRSS(channelId);
            })
            .then(function (data) {
                if (!data) return;
                var newChannel = {
                    id: App.generateId(),
                    channelId: data.channelId,
                    name: data.name,
                    videos: data.videos,
                    lastUpdated: new Date().toISOString()
                };
                channels.push(newChannel);
                saveChannels();
                render();
                var inputEl = el('yt-channel-input');
                if (inputEl) inputEl.value = '';
                App.toast('Added ' + data.name + '. Fetching stats...', 'success');

                // Auto-fetch stats in background
                autoFetchStats(data.channelId, data.videos).then(function (stats) {
                    if (stats.videoViews.length > 0) {
                        // Attach view counts to video objects
                        for (var vi = 0; vi < stats.videoViews.length; vi++) {
                            var sv = stats.videoViews[vi];
                            var vid = newChannel.videos.find(function (v) { return v.videoId === sv.videoId; });
                            if (vid) { vid.views = sv.views; vid.likes = sv.likes; }
                        }
                    }
                    if (stats.subscribers) newChannel.subscribers = stats.subscribers;
                    if (stats.totalViews) newChannel.totalViews = stats.totalViews;
                    saveChannels();
                    autoLogStats(data.channelId, stats);
                    render();
                });
            })
            .catch(function (err) {
                if (err && err.handled) return;
                App.toast(err.message || 'Failed to add channel.', 'error');
            })
            .finally(function () {
                setLoading(addBtn, false);
            });
    }

    function refreshChannel(id) {
        var channel = channels.find(function (ch) { return ch.id === id; });
        if (!channel) return;

        fetchRSS(channel.channelId)
            .then(function (data) {
                channel.name = data.name;
                channel.videos = data.videos;
                channel.lastUpdated = new Date().toISOString();
                saveChannels();
                render();

                // Auto-fetch stats in background
                return autoFetchStats(channel.channelId, data.videos).then(function (stats) {
                    if (stats.videoViews.length > 0) {
                        for (var vi = 0; vi < stats.videoViews.length; vi++) {
                            var sv = stats.videoViews[vi];
                            var vid = channel.videos.find(function (v) { return v.videoId === sv.videoId; });
                            if (vid) { vid.views = sv.views; vid.likes = sv.likes; }
                        }
                    }
                    if (stats.subscribers) channel.subscribers = stats.subscribers;
                    if (stats.totalViews) channel.totalViews = stats.totalViews;
                    saveChannels();
                    autoLogStats(channel.channelId, stats);
                    render();
                });
            })
            .catch(function () {
                App.toast('Failed to refresh ' + channel.name, 'error');
            });
    }

    function refreshAll() {
        if (channels.length === 0) {
            App.toast('No channels to refresh', 'error');
            return;
        }
        var refreshBtn = el('refresh-all-btn');
        setLoading(refreshBtn, true);

        var promises = channels.map(function (channel) {
            return fetchRSS(channel.channelId)
                .then(function (data) {
                    channel.name = data.name;
                    channel.videos = data.videos;
                    channel.lastUpdated = new Date().toISOString();
                })
                .catch(function () {});
        });

        Promise.all(promises)
            .then(function () {
                saveChannels();
                render();
                App.toast('All channels refreshed. Fetching stats...', 'success');

                // Auto-fetch stats for all channels in parallel
                var statPromises = channels.map(function (channel) {
                    return autoFetchStats(channel.channelId, channel.videos).then(function (stats) {
                        if (stats.videoViews.length > 0) {
                            for (var vi = 0; vi < stats.videoViews.length; vi++) {
                                var sv = stats.videoViews[vi];
                                var vid = channel.videos.find(function (v) { return v.videoId === sv.videoId; });
                                if (vid) { vid.views = sv.views; vid.likes = sv.likes; }
                            }
                        }
                        if (stats.subscribers) channel.subscribers = stats.subscribers;
                        if (stats.totalViews) channel.totalViews = stats.totalViews;
                        autoLogStats(channel.channelId, stats);
                    }).catch(function () {});
                });
                return Promise.all(statPromises);
            })
            .then(function () {
                saveChannels();
                render();
            })
            .finally(function () {
                setLoading(refreshBtn, false);
            });
    }

    function removeChannel(id) {
        var channel = channels.find(function (ch) { return ch.id === id; });
        var name = channel ? channel.name : 'Channel';
        channels = channels.filter(function (ch) { return ch.id !== id; });
        saveChannels();
        render();
        App.toast('Removed ' + name, 'success');
    }

    // ── Rendering ─────────────────────────────────────────────────────

    function renderChannelCard(channel) {
        var initial = channel.name ? channel.name.charAt(0).toUpperCase() : '?';

        var videosHtml = '';
        if (channel.videos && channel.videos.length > 0) {
            videosHtml = '<div class="yt-videos">';
            var limit = Math.min(channel.videos.length, 3);
            for (var i = 0; i < limit; i++) {
                var v = channel.videos[i];
                var viewsTag = v.views != null
                    ? '<span class="yt-video-views">' + formatNumber(v.views) + ' views</span>'
                    : '';
                var likesTag = v.likes != null && v.likes > 0
                    ? '<span class="yt-video-likes">' + formatNumber(v.likes) + ' likes</span>'
                    : '';
                videosHtml += '<a class="yt-video-item" href="https://www.youtube.com/watch?v='
                    + escapeHtml(v.videoId) + '" target="_blank" rel="noopener">'
                    + '<img class="yt-video-thumb" src="' + escapeHtml(v.thumbnail)
                    + '" alt="" loading="lazy">'
                    + '<div class="yt-video-info">'
                    + '<span class="yt-video-title">' + escapeHtml(v.title) + '</span>'
                    + '<span class="yt-video-date">' + formatVideoDate(v.published)
                    + (viewsTag ? ' &middot; ' + viewsTag : '')
                    + (likesTag ? ' &middot; ' + likesTag : '')
                    + '</span>'
                    + '</div></a>';
            }
            videosHtml += '</div>';
        }

        var refreshIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
        var deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        var linkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

        // Auto-fetched channel-level stats bar (subs + total views)
        var autoStatsHtml = '';
        if (channel.subscribers || channel.totalViews) {
            autoStatsHtml = '<div class="channel-stats-bar">';
            if (channel.subscribers) {
                autoStatsHtml += '<div class="channel-stat-item">'
                    + '<span class="channel-stat-val">' + formatNumber(channel.subscribers) + '</span>'
                    + '<span class="channel-stat-lbl">Subscribers</span></div>';
            }
            if (channel.totalViews) {
                autoStatsHtml += '<div class="channel-stat-item">'
                    + '<span class="channel-stat-val">' + formatNumber(channel.totalViews) + '</span>'
                    + '<span class="channel-stat-lbl">Recent Views</span></div>';
            }
            autoStatsHtml += '</div>';
        }

        var statsHtml = '';
        if (channel.videos && channel.videos.length > 0) {
            var activity = getActivityStatus(channel.videos);
            var frequency = calcUploadFrequency(channel.videos);
            var lastUpload = timeAgo(channel.videos[0].published);
            var dateRange = formatDateRange(channel.videos);

            statsHtml = '<div class="channel-stats-bar">'
                + '<div class="channel-activity">'
                + '<span class="activity-dot ' + activity.dot + '"></span>'
                + '<span>' + escapeHtml(activity.label) + '</span>'
                + '</div>'
                + '<div class="channel-stat-item">'
                + '<span class="channel-stat-val">' + channel.videos.length + '</span>'
                + '<span class="channel-stat-lbl">Videos</span>'
                + '</div>'
                + '<div class="channel-stat-item">'
                + '<span class="channel-stat-val">' + escapeHtml(frequency) + '</span>'
                + '<span class="channel-stat-lbl">Frequency</span>'
                + '</div>'
                + '<div class="channel-stat-item">'
                + '<span class="channel-stat-val">' + escapeHtml(lastUpload) + '</span>'
                + '<span class="channel-stat-lbl">Last Upload</span>'
                + '</div>'
                + '</div>';
            if (dateRange) {
                statsHtml += '<div class="channel-date-range">' + escapeHtml(dateRange) + '</div>';
            }
        }

        // Logged stats (auto or manual) from history
        var loggedStats = getChannelStats(channel.channelId);
        var latestStats = loggedStats.length > 0 ? loggedStats[loggedStats.length - 1] : null;

        var manualStatsHtml = '';
        if (latestStats && (latestStats.impressions != null || latestStats.watchHours != null)) {
            manualStatsHtml = '<div class="channel-stats-bar" style="margin-top: 8px;">';
            if (latestStats.impressions != null) {
                manualStatsHtml += '<div class="channel-stat-item">'
                    + '<span class="channel-stat-val">' + formatNumber(latestStats.impressions) + '</span>'
                    + '<span class="channel-stat-lbl">Impressions</span></div>';
            }
            if (latestStats.watchHours != null) {
                manualStatsHtml += '<div class="channel-stat-item">'
                    + '<span class="channel-stat-val">' + latestStats.watchHours + 'h</span>'
                    + '<span class="channel-stat-lbl">Watch Hrs</span></div>';
            }
            manualStatsHtml += '</div>';
        }

        var statsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>';

        return '<div class="channel-card" data-id="' + channel.id + '">'
            + '<div class="channel-header">'
            + '<div class="channel-avatar-letter">' + initial + '</div>'
            + '<div class="channel-header-info">'
            + '<span class="channel-name">' + escapeHtml(channel.name) + '</span>'
            + '<span class="channel-meta">' + (channel.videos ? channel.videos.length : 0) + ' recent videos</span>'
            + '</div></div>'
            + autoStatsHtml
            + statsHtml
            + manualStatsHtml
            + videosHtml
            + '<div class="channel-footer">'
            + '<span class="channel-updated">Updated ' + timeAgo(channel.lastUpdated) + '</span>'
            + '<div class="td-actions">'
            + '<a class="btn-icon" href="https://www.youtube.com/channel/' + escapeHtml(channel.channelId)
            + '" target="_blank" rel="noopener" title="Visit Channel">' + linkIcon + '</a>'
            + '<button class="btn-icon" data-action="stats" title="Log Stats">' + statsIcon + '</button>'
            + '<button class="btn-icon" data-action="refresh" title="Refresh">' + refreshIcon + '</button>'
            + '<button class="btn-icon" data-action="remove" title="Remove">' + deleteIcon + '</button>'
            + '</div></div>'
            + '<button class="btn btn-primary btn-sm ch-open-btn" data-action="open-channel">Open Channel</button>'
            + '</div>';
    }

    function render() {
        var grid = el('channels-grid');
        var empty = el('channels-empty');
        if (!grid || !empty) return;

        if (channels.length === 0) {
            grid.innerHTML = '';
            grid.style.display = 'none';
            empty.style.display = '';
        } else {
            empty.style.display = 'none';
            grid.style.display = '';
            grid.innerHTML = channels.map(renderChannelCard).join('');
        }
    }

    // ── Events ────────────────────────────────────────────────────────

    function handleGridClick(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var card = btn.closest('.channel-card');
        if (!card) return;
        var id = card.getAttribute('data-id');
        var action = btn.getAttribute('data-action');
        if (action === 'refresh') refreshChannel(id);
        else if (action === 'remove') removeChannel(id);
        else if (action === 'stats') openStatsModal(id);
    }

    // ── Init ──────────────────────────────────────────────────────────

    /**
     * Auto-fetch stats for all existing channels that don't have stats yet.
     * Runs once on init, silently in the background.
     */
    function autoFetchAllOnInit() {
        if (channels.length === 0) return;

        // Fetch stats for every channel (even if they already have some — to update)
        var promises = channels.map(function (channel) {
            return autoFetchStats(channel.channelId, channel.videos)
                .then(function (stats) {
                    if (stats.videoViews.length > 0) {
                        for (var vi = 0; vi < stats.videoViews.length; vi++) {
                            var sv = stats.videoViews[vi];
                            for (var vj = 0; vj < (channel.videos || []).length; vj++) {
                                if (channel.videos[vj].videoId === sv.videoId) {
                                    channel.videos[vj].views = sv.views;
                                    channel.videos[vj].likes = sv.likes;
                                }
                            }
                        }
                    }
                    if (stats.subscribers) channel.subscribers = stats.subscribers;
                    if (stats.totalViews) channel.totalViews = stats.totalViews;
                    autoLogStats(channel.channelId, stats);
                })
                .catch(function () {});
        });

        Promise.all(promises).then(function () {
            saveChannels();
            render();
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CHANNEL DETAIL PAGE
    // ══════════════════════════════════════════════════════════════════════

    var ANIMALS = ['wolf', 'bear', 'eagle', 'fox', 'cat', 'owl', 'lion', 'penguin'];
    var IDEAS_KEY = 'was_yt_ideas';
    var IMPROVEMENTS_KEY = 'was_yt_improvements';
    var TIMELOG_KEY = 'was_yt_timelog';
    var activeChannelId = null;
    var growthChart = null;
    var perfChart = null;

    // ── Channel Data Persistence ──────────────────────────────────────

    function loadIdeas(channelId) {
        try { var d = localStorage.getItem(IDEAS_KEY); var all = d ? JSON.parse(d) : {}; return all[channelId] || []; }
        catch (e) { return []; }
    }
    function saveIdeas(channelId, ideas) {
        try { var d = localStorage.getItem(IDEAS_KEY); var all = d ? JSON.parse(d) : {}; all[channelId] = ideas; localStorage.setItem(IDEAS_KEY, JSON.stringify(all)); }
        catch (e) {}
    }
    function loadImprovements(channelId) {
        try { var d = localStorage.getItem(IMPROVEMENTS_KEY); var all = d ? JSON.parse(d) : {}; return all[channelId] || []; }
        catch (e) { return []; }
    }
    function saveImprovements(channelId, items) {
        try { var d = localStorage.getItem(IMPROVEMENTS_KEY); var all = d ? JSON.parse(d) : {}; all[channelId] = items; localStorage.setItem(IMPROVEMENTS_KEY, JSON.stringify(all)); }
        catch (e) {}
    }
    function loadTimelog(channelId) {
        try { var d = localStorage.getItem(TIMELOG_KEY); var all = d ? JSON.parse(d) : {}; return all[channelId] || []; }
        catch (e) { return []; }
    }
    function saveTimelog(channelId, entries) {
        try { var d = localStorage.getItem(TIMELOG_KEY); var all = d ? JSON.parse(d) : {}; all[channelId] = entries; localStorage.setItem(TIMELOG_KEY, JSON.stringify(all)); }
        catch (e) {}
    }

    // ── Assign animal to channel ──────────────────────────────────────

    function getChannelAnimal(channel) {
        if (channel.animal) return channel.animal;
        // Hash the channel name to pick a consistent animal
        var hash = 0;
        var name = channel.name || channel.channelId || '';
        for (var i = 0; i < name.length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
        channel.animal = ANIMALS[Math.abs(hash) % ANIMALS.length];
        saveChannels();
        return channel.animal;
    }

    function getChannelInitials(name) {
        if (!name) return '??';
        var words = name.trim().split(/\s+/);
        if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
        return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
    }

    // ── Open Channel Detail ───────────────────────────────────────────

    function openChannelDetail(channelId) {
        var channel = channels.find(function (c) { return c.channelId === channelId || c.id === channelId; });
        if (!channel) return;
        activeChannelId = channel.channelId;

        // Set title and link
        var titleEl = document.getElementById('channel-detail-title');
        if (titleEl) titleEl.textContent = channel.name || 'Channel';
        var linkEl = document.getElementById('channel-detail-link');
        if (linkEl) linkEl.href = 'https://www.youtube.com/channel/' + channel.channelId;

        // Navigate to detail page
        App.navigateTo('channel-detail');

        // Reset to overview tab
        switchTab('overview');

        // Render all tabs
        renderOverview(channel);
        renderIdeas(channel.channelId);
        renderImprovements(channel.channelId);
        renderTimelog(channel.channelId);
    }

    // ── Tab Switching ─────────────────────────────────────────────────

    function switchTab(tabName) {
        var tabs = document.querySelectorAll('.channel-tab');
        var contents = document.querySelectorAll('.channel-tab-content');
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].getAttribute('data-tab') === tabName) tabs[i].classList.add('active');
            else tabs[i].classList.remove('active');
        }
        for (var j = 0; j < contents.length; j++) {
            if (contents[j].id === 'ch-tab-' + tabName) contents[j].classList.add('active');
            else contents[j].classList.remove('active');
        }
    }

    // ── Overview Tab ──────────────────────────────────────────────────

    function renderOverview(channel) {
        // Stats
        var subsEl = document.getElementById('ch-stat-subs');
        var viewsEl = document.getElementById('ch-stat-views');
        var videosEl = document.getElementById('ch-stat-videos');
        var freqEl = document.getElementById('ch-stat-freq');

        if (subsEl) subsEl.textContent = channel.subscribers ? formatNumber(channel.subscribers) : '--';
        if (viewsEl) viewsEl.textContent = channel.totalViews ? formatNumber(channel.totalViews) : '--';
        if (videosEl) videosEl.textContent = channel.videos ? channel.videos.length : 0;
        if (freqEl) freqEl.textContent = channel.videos ? calcUploadFrequency(channel.videos) : '--';

        // Videos list
        var listEl = document.getElementById('ch-videos-list');
        if (listEl && channel.videos && channel.videos.length > 0) {
            var html = '';
            for (var i = 0; i < channel.videos.length; i++) {
                var v = channel.videos[i];
                html += '<a class="ch-video-item" href="https://www.youtube.com/watch?v=' + escapeHtml(v.videoId) + '" target="_blank" rel="noopener">'
                    + '<img class="ch-video-thumb" src="' + escapeHtml(v.thumbnail) + '" alt="" loading="lazy">'
                    + '<div class="ch-video-info">'
                    + '<span class="ch-video-title">' + escapeHtml(v.title) + '</span>'
                    + '<span class="ch-video-meta">' + formatVideoDate(v.published)
                    + (v.views != null ? ' &middot; ' + formatNumber(v.views) + ' views' : '')
                    + (v.likes != null && v.likes > 0 ? ' &middot; ' + formatNumber(v.likes) + ' likes' : '')
                    + '</span></div></a>';
            }
            listEl.innerHTML = html;
        } else if (listEl) {
            listEl.innerHTML = '<p style="color:#666; padding: 16px 0">No videos found.</p>';
        }

        // Growth chart
        renderGrowthChart(channel.channelId);
        renderPerfChart(channel);
    }

    function renderGrowthChart(channelId) {
        var canvas = document.getElementById('ch-growth-chart');
        if (!canvas) return;
        if (growthChart) { growthChart.destroy(); growthChart = null; }

        var stats = getChannelStats(channelId);
        if (stats.length < 2) {
            canvas.parentElement.parentElement.style.display = 'none';
            return;
        }
        canvas.parentElement.parentElement.style.display = '';

        var labels = stats.map(function (s) {
            var p = s.date.split('-');
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return months[parseInt(p[1], 10) - 1] + ' ' + parseInt(p[2], 10);
        });

        var datasets = [];
        if (stats.some(function (s) { return s.views != null; })) {
            datasets.push({ label: 'Views', data: stats.map(function (s) { return s.views || 0; }), borderColor: '#7c5cfc', backgroundColor: 'rgba(124,92,252,0.08)', fill: true, tension: 0.3, borderWidth: 2 });
        }
        if (stats.some(function (s) { return s.subscribers != null; })) {
            datasets.push({ label: 'Subscribers', data: stats.map(function (s) { return s.subscribers || 0; }), borderColor: '#34d399', fill: false, tension: 0.3, borderWidth: 2 });
        }

        if (datasets.length === 0) { canvas.parentElement.parentElement.style.display = 'none'; return; }

        growthChart = new Chart(canvas, {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: '#252540' }, ticks: { color: '#5a5a78' } },
                    y: { grid: { color: '#252540' }, ticks: { color: '#9898b0', callback: function (v) { return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v; } } }
                },
                plugins: { legend: { labels: { color: '#9898b0', usePointStyle: true } } }
            }
        });
    }

    function renderPerfChart(channel) {
        var canvas = document.getElementById('ch-perf-chart');
        if (!canvas) return;
        if (perfChart) { perfChart.destroy(); perfChart = null; }

        if (!channel.videos || channel.videos.length === 0 || !channel.videos.some(function (v) { return v.views != null; })) {
            canvas.parentElement.parentElement.style.display = 'none';
            return;
        }
        canvas.parentElement.parentElement.style.display = '';

        var vids = channel.videos.slice().reverse(); // oldest first
        var labels = vids.map(function (v) { return truncateStr(v.title, 20); });
        var views = vids.map(function (v) { return v.views || 0; });

        perfChart = new Chart(canvas, {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: 'Views', data: views, backgroundColor: 'rgba(124,92,252,0.6)', borderColor: '#7c5cfc', borderWidth: 1 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: '#252540' }, ticks: { color: '#5a5a78', maxRotation: 45 } },
                    y: { grid: { color: '#252540' }, ticks: { color: '#9898b0', callback: function (v) { return v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : v; } } }
                },
                plugins: { legend: { display: false } }
            }
        });
    }

    // ── Ideas Tab ─────────────────────────────────────────────────────

    var STATUS_COLORS = {
        brainstorm: '#a78bfa', planned: '#60a5fa', scripting: '#fbbf24',
        filming: '#f97316', editing: '#ec4899', published: '#34d399'
    };

    function renderIdeas(channelId) {
        var ideas = loadIdeas(channelId);
        var listEl = document.getElementById('ch-ideas-list');
        var emptyEl = document.getElementById('ch-ideas-empty');
        if (!listEl) return;

        if (ideas.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        // Sort: published last, then by priority (high first)
        var priorityOrder = { high: 0, medium: 1, low: 2 };
        ideas.sort(function (a, b) {
            if (a.status === 'published' && b.status !== 'published') return 1;
            if (b.status === 'published' && a.status !== 'published') return -1;
            return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
        });

        var html = '';
        for (var i = 0; i < ideas.length; i++) {
            var idea = ideas[i];
            var color = STATUS_COLORS[idea.status] || '#888';
            var priBadge = idea.priority === 'high' ? '<span class="ch-priority-badge high">HIGH</span>' : idea.priority === 'low' ? '<span class="ch-priority-badge low">LOW</span>' : '';
            html += '<div class="ch-idea-card" data-idea-id="' + idea.id + '">'
                + '<div class="ch-idea-header">'
                + '<span class="ch-status-dot" style="background:' + color + '"></span>'
                + '<span class="ch-idea-title">' + escapeHtml(idea.title) + '</span>'
                + priBadge
                + '</div>'
                + (idea.description ? '<p class="ch-idea-desc">' + escapeHtml(idea.description) + '</p>' : '')
                + '<div class="ch-idea-footer">'
                + '<span class="ch-idea-status">' + escapeHtml(idea.status) + '</span>'
                + '<div class="td-actions">'
                + '<button class="btn-icon" data-action="edit-idea" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>'
                + '<button class="btn-icon" data-action="delete-idea" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
                + '</div></div></div>';
        }
        listEl.innerHTML = html;
    }

    function openIdeaModal(channelId, ideaId) {
        var idea = null;
        if (ideaId) {
            var ideas = loadIdeas(channelId);
            idea = ideas.find(function (i) { return i.id === ideaId; });
        }
        document.getElementById('idea-id').value = ideaId || '';
        document.getElementById('idea-title').value = idea ? idea.title : '';
        document.getElementById('idea-description').value = idea ? (idea.description || '') : '';
        document.getElementById('idea-priority').value = idea ? idea.priority : 'medium';
        document.getElementById('idea-status').value = idea ? idea.status : 'brainstorm';
        document.getElementById('idea-modal-title').textContent = idea ? 'Edit Idea' : 'Add Idea';
        App.showModal('idea-modal');
    }

    function handleIdeaSubmit(e) {
        e.preventDefault();
        if (!activeChannelId) return;
        var ideas = loadIdeas(activeChannelId);
        var id = document.getElementById('idea-id').value;
        var data = {
            title: document.getElementById('idea-title').value.trim(),
            description: document.getElementById('idea-description').value.trim(),
            priority: document.getElementById('idea-priority').value,
            status: document.getElementById('idea-status').value
        };
        if (!data.title) return;

        if (id) {
            var existing = ideas.find(function (i) { return i.id === id; });
            if (existing) { existing.title = data.title; existing.description = data.description; existing.priority = data.priority; existing.status = data.status; }
        } else {
            data.id = App.generateId();
            data.created = new Date().toISOString();
            ideas.push(data);
        }
        saveIdeas(activeChannelId, ideas);
        App.closeModal('idea-modal');
        renderIdeas(activeChannelId);
        App.toast('Idea saved!', 'success');
    }

    // ── Improvements Tab ──────────────────────────────────────────────

    var IMP_COLORS = {
        content: '#a78bfa', editing: '#ec4899', thumbnails: '#f97316',
        'titles': '#fbbf24', audio: '#60a5fa', engagement: '#34d399', other: '#888'
    };

    function renderImprovements(channelId) {
        var items = loadImprovements(channelId);
        var listEl = document.getElementById('ch-improvements-list');
        var emptyEl = document.getElementById('ch-improvements-empty');
        if (!listEl) return;

        if (items.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        var html = '';
        for (var i = 0; i < items.length; i++) {
            var imp = items[i];
            var catColor = IMP_COLORS[imp.category] || '#888';
            html += '<div class="ch-improvement-card" data-imp-id="' + imp.id + '">'
                + '<div class="ch-idea-header">'
                + '<span class="ch-status-dot" style="background:' + catColor + '"></span>'
                + '<span class="ch-idea-title">' + escapeHtml(imp.title) + '</span>'
                + '<span class="ch-cat-badge">' + escapeHtml(imp.category) + '</span>'
                + '</div>'
                + (imp.details ? '<p class="ch-idea-desc">' + escapeHtml(imp.details) + '</p>' : '')
                + '<div class="ch-idea-footer">'
                + '<span class="ch-idea-status" style="color:#666">' + formatDateNice(imp.created) + '</span>'
                + '<div class="td-actions">'
                + '<button class="btn-icon" data-action="edit-imp" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>'
                + '<button class="btn-icon" data-action="delete-imp" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
                + '</div></div></div>';
        }
        listEl.innerHTML = html;
    }

    function openImprovementModal(channelId, impId) {
        var imp = null;
        if (impId) {
            var items = loadImprovements(channelId);
            imp = items.find(function (i) { return i.id === impId; });
        }
        document.getElementById('improvement-id').value = impId || '';
        document.getElementById('improvement-title').value = imp ? imp.title : '';
        document.getElementById('improvement-details').value = imp ? (imp.details || '') : '';
        document.getElementById('improvement-category').value = imp ? imp.category : 'content';
        document.getElementById('improvement-modal-title').textContent = imp ? 'Edit Improvement' : 'Add Improvement';
        App.showModal('improvement-modal');
    }

    function handleImprovementSubmit(e) {
        e.preventDefault();
        if (!activeChannelId) return;
        var items = loadImprovements(activeChannelId);
        var id = document.getElementById('improvement-id').value;
        var data = {
            title: document.getElementById('improvement-title').value.trim(),
            details: document.getElementById('improvement-details').value.trim(),
            category: document.getElementById('improvement-category').value
        };
        if (!data.title) return;

        if (id) {
            var existing = items.find(function (i) { return i.id === id; });
            if (existing) { existing.title = data.title; existing.details = data.details; existing.category = data.category; }
        } else {
            data.id = App.generateId();
            data.created = new Date().toISOString();
            items.push(data);
        }
        saveImprovements(activeChannelId, items);
        App.closeModal('improvement-modal');
        renderImprovements(activeChannelId);
        App.toast('Improvement saved!', 'success');
    }

    // ── Time Log Tab ──────────────────────────────────────────────────

    function renderTimelog(channelId) {
        var entries = loadTimelog(channelId);
        var listEl = document.getElementById('ch-timelog-list');
        var emptyEl = document.getElementById('ch-timelog-empty');
        var summaryEl = document.getElementById('ch-time-summary');
        if (!listEl) return;

        if (entries.length === 0) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = '';
            if (summaryEl) summaryEl.innerHTML = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        // Sort by date descending
        entries.sort(function (a, b) { return b.date > a.date ? 1 : b.date < a.date ? -1 : 0; });

        // Summary
        var totalHours = 0;
        var byTask = {};
        for (var i = 0; i < entries.length; i++) {
            totalHours += entries[i].hours || 0;
            var t = entries[i].task || 'other';
            byTask[t] = (byTask[t] || 0) + (entries[i].hours || 0);
        }
        if (summaryEl) {
            var sumHtml = '<div class="ch-time-stat"><span class="stat-value">' + totalHours.toFixed(1) + 'h</span><span class="stat-label">Total</span></div>';
            var tasks = Object.keys(byTask);
            for (var j = 0; j < tasks.length; j++) {
                sumHtml += '<div class="ch-time-stat"><span class="stat-value">' + byTask[tasks[j]].toFixed(1) + 'h</span><span class="stat-label">' + tasks[j] + '</span></div>';
            }
            summaryEl.innerHTML = sumHtml;
        }

        var html = '';
        for (var k = 0; k < entries.length; k++) {
            var entry = entries[k];
            html += '<div class="ch-timelog-entry" data-time-id="' + entry.id + '">'
                + '<div class="ch-time-left">'
                + '<span class="ch-time-date">' + formatDateNice(entry.date) + '</span>'
                + '<span class="ch-time-task">' + escapeHtml(entry.task || 'other') + (entry.note ? ' — ' + escapeHtml(entry.note) : '') + '</span>'
                + '</div>'
                + '<div class="ch-time-right">'
                + '<span class="ch-time-hours">' + (entry.hours || 0) + 'h</span>'
                + '<button class="btn-icon" data-action="delete-time" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
                + '</div></div>';
        }
        listEl.innerHTML = html;
    }

    function openTimelogModal() {
        document.getElementById('timelog-id').value = '';
        document.getElementById('timelog-hours').value = '';
        document.getElementById('timelog-task').value = 'editing';
        document.getElementById('timelog-note').value = '';
        var dateEl = document.getElementById('timelog-date');
        var d = new Date();
        dateEl.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        App.showModal('timelog-modal');
    }

    function handleTimelogSubmit(e) {
        e.preventDefault();
        if (!activeChannelId) return;
        var entries = loadTimelog(activeChannelId);
        var data = {
            id: App.generateId(),
            date: document.getElementById('timelog-date').value,
            hours: parseFloat(document.getElementById('timelog-hours').value) || 0,
            task: document.getElementById('timelog-task').value,
            note: document.getElementById('timelog-note').value.trim()
        };
        if (!data.date || data.hours <= 0) return;
        entries.push(data);
        saveTimelog(activeChannelId, entries);
        App.closeModal('timelog-modal');
        renderTimelog(activeChannelId);
        App.toast('Time logged!', 'success');
    }

    // ── Channel Detail Events ─────────────────────────────────────────

    function initChannelDetail() {
        // Back button
        var backBtn = document.getElementById('channel-back-btn');
        if (backBtn) backBtn.addEventListener('click', function () { App.navigateTo('youtube'); });

        // Tab switching
        var tabsContainer = document.querySelector('.channel-tabs');
        if (tabsContainer) {
            tabsContainer.addEventListener('click', function (e) {
                var tab = e.target.closest('.channel-tab');
                if (tab) switchTab(tab.getAttribute('data-tab'));
            });
        }

        // Ideas
        var addIdeaBtn = document.getElementById('ch-add-idea-btn');
        if (addIdeaBtn) addIdeaBtn.addEventListener('click', function () { openIdeaModal(activeChannelId); });
        var ideaForm = document.getElementById('idea-form');
        if (ideaForm) ideaForm.addEventListener('submit', handleIdeaSubmit);
        var ideasList = document.getElementById('ch-ideas-list');
        if (ideasList) ideasList.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            var card = btn.closest('[data-idea-id]');
            if (!card) return;
            var ideaId = card.getAttribute('data-idea-id');
            if (btn.getAttribute('data-action') === 'edit-idea') openIdeaModal(activeChannelId, ideaId);
            else if (btn.getAttribute('data-action') === 'delete-idea') {
                var ideas = loadIdeas(activeChannelId);
                ideas = ideas.filter(function (i) { return i.id !== ideaId; });
                saveIdeas(activeChannelId, ideas);
                renderIdeas(activeChannelId);
                App.toast('Idea deleted', 'success');
            }
        });

        // Improvements
        var addImpBtn = document.getElementById('ch-add-improvement-btn');
        if (addImpBtn) addImpBtn.addEventListener('click', function () { openImprovementModal(activeChannelId); });
        var impForm = document.getElementById('improvement-form');
        if (impForm) impForm.addEventListener('submit', handleImprovementSubmit);
        var impList = document.getElementById('ch-improvements-list');
        if (impList) impList.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            var card = btn.closest('[data-imp-id]');
            if (!card) return;
            var impId = card.getAttribute('data-imp-id');
            if (btn.getAttribute('data-action') === 'edit-imp') openImprovementModal(activeChannelId, impId);
            else if (btn.getAttribute('data-action') === 'delete-imp') {
                var items = loadImprovements(activeChannelId);
                items = items.filter(function (i) { return i.id !== impId; });
                saveImprovements(activeChannelId, items);
                renderImprovements(activeChannelId);
                App.toast('Improvement deleted', 'success');
            }
        });

        // Time log
        var addTimeBtn = document.getElementById('ch-add-time-btn');
        if (addTimeBtn) addTimeBtn.addEventListener('click', openTimelogModal);
        var timeForm = document.getElementById('timelog-form');
        if (timeForm) timeForm.addEventListener('submit', handleTimelogSubmit);
        var timeList = document.getElementById('ch-timelog-list');
        if (timeList) timeList.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action="delete-time"]');
            if (!btn) return;
            var entry = btn.closest('[data-time-id]');
            if (!entry) return;
            var timeId = entry.getAttribute('data-time-id');
            var entries = loadTimelog(activeChannelId);
            entries = entries.filter(function (t) { return t.id !== timeId; });
            saveTimelog(activeChannelId, entries);
            renderTimelog(activeChannelId);
            App.toast('Time entry deleted', 'success');
        });
    }

    // ── Update channel card to include Open button ────────────────────

    function handleGridClickExtended(e) {
        var openBtn = e.target.closest('[data-action="open-channel"]');
        if (openBtn) {
            var card = openBtn.closest('.channel-card');
            if (card) {
                var id = card.getAttribute('data-id');
                var channel = channels.find(function (c) { return c.id === id; });
                if (channel) openChannelDetail(channel.channelId);
            }
        }
    }

    // ── Init ──────────────────────────────────────────────────────────

    function init() {
        loadChannels();
        render();

        var addBtn = el('add-channel-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function () {
                var inputEl = el('yt-channel-input');
                var input = inputEl ? inputEl.value.trim() : '';
                if (!input) {
                    App.toast('Please enter a channel URL or @handle', 'error');
                    return;
                }
                addChannel(input);
            });
        }

        var channelInput = el('yt-channel-input');
        if (channelInput) {
            channelInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var input = channelInput.value.trim();
                    if (input) addChannel(input);
                }
            });
        }

        var refreshBtn = el('refresh-all-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', refreshAll);

        var grid = el('channels-grid');
        if (grid) {
            grid.addEventListener('click', handleGridClick);
            grid.addEventListener('click', handleGridClickExtended);
        }

        var statsForm = document.getElementById('yt-stats-form');
        if (statsForm) statsForm.addEventListener('submit', handleStatsFormSubmit);

        // Init channel detail page
        initChannelDetail();

        // Auto-fetch stats in background on page load
        setTimeout(autoFetchAllOnInit, 1500);

        // If home 3D scene is active, add channel planets now
        if (typeof Home3D !== 'undefined' && Home3D.refreshChannelPlanets) {
            Home3D.refreshChannelPlanets();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        addChannel: addChannel,
        refreshAll: refreshAll,
        refreshChannel: refreshChannel,
        removeChannel: removeChannel,
        openChannelDetail: openChannelDetail,
        getChannels: function () { return channels; },
        getChannelAnimal: getChannelAnimal,
        getChannelInitials: getChannelInitials
    };
})();
