// In-memory session state & event logs buffer inside the worker isolate
let currentSession = {
  connected: false,
  countryCode: null,
  assignedNode: null,
  connectedSince: null,
  connectionDurationSeconds: 12
};

let auditLogs = [
  { timestamp: new Date(Date.now() - 120000).toISOString(), type: 'SYSTEM', message: 'Worker initialized with MD, RO, US routing nodes.' },
  { timestamp: new Date(Date.now() - 60000).toISOString(), type: 'HEALTH', message: 'GET /api/healthz checked nominal.' },
  { timestamp: new Date().toISOString(), type: 'STATUS', message: 'Daemon ready for client handshake connection.' }
];

function recordLog(type, message) {
  auditLogs.push({ timestamp: new Date().toISOString(), type, message });
  if (auditLogs.length > 50) auditLogs.shift(); // keep last 50 entries
}

const COUNTRIES = {
  'MD': { code: 'MD', name: 'Moldova', region: 'Eastern Europe', flag: '🇲🇩', ip: '193.105.134.12', latency: '18ms' },
  'RO': { code: 'RO', name: 'Romania', region: 'Eastern Europe', flag: '🇷🇴', ip: '89.34.11.190', latency: '24ms' },
  'US': { code: 'US', name: 'United States', region: 'North America', flag: '🇺🇸', ip: '198.51.100.45', latency: '75ms' }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. GET /api/healthz
    if (path === '/api/healthz' && method === 'GET') {
      recordLog('HEALTH', 'Health check endpoint accessed via /api/healthz');
      return new Response(JSON.stringify({ 
        status: 'healthy', 
        service: 'Atlas VPN Secure Edge Cluster',
        timestamp: new Date().toISOString() 
      }), { headers: corsHeaders });
    }

    // 2. GET /api/test?ms=37
    if (path === '/api/test' && method === 'GET') {
      const delay = parseInt(url.searchParams.get('ms')) || 37;
      await new Promise(resolve => setTimeout(resolve, delay));
      return new Response(JSON.stringify({ success: true, latencyMs: delay }), { headers: corsHeaders });
    }

    // 3. GET /api/vpn/countries
    if (path === '/api/vpn/countries' && method === 'GET') {
      return new Response(JSON.stringify(Object.values(COUNTRIES)), { headers: corsHeaders });
    }

    // 4. GET /api/vpn/status
    if (path === '/api/vpn/status' && method === 'GET') {
      return new Response(JSON.stringify({
        connected: currentSession.connected,
        countryCode: currentSession.countryCode,
        assignedNode: currentSession.assignedNode,
        connectedSince: currentSession.connectedSince,
        durationSeconds: currentSession.connected ? Math.floor((Date.now() - currentSession.connectedSince) / 1000) : 12
      }), { headers: corsHeaders });
    }

    // 5. GET /api/vpn/logs
    if (path === '/api/vpn/logs' && method === 'GET') {
      return new Response(JSON.stringify({
        total: auditLogs.length,
        logs: auditLogs
      }), { headers: corsHeaders });
    }

    // 6. GET /api/vpn/activity
    if (path === '/api/vpn/activity' && method === 'GET') {
      return new Response(JSON.stringify({
        activeSession: currentSession.connected,
        node: currentSession.assignedNode || { name: 'None', code: 'N/A' },
        recentActivityCount: auditLogs.length,
        lastLog: auditLogs[auditLogs.length - 1] || null
      }), { headers: corsHeaders });
    }

    // 7. POST /api/vpn/connect (accepts {"countryCode": "MD" | "RO" | "US"})
    if (path === '/api/vpn/connect' && method === 'POST') {
      try {
        let body = {};
        try { body = await request.json(); } catch(e) {}
        
        const code = (body.countryCode || '').toUpperCase();

        if (!COUNTRIES[code]) {
          recordLog('ERROR', `404 country not found for requested code: '${code}'`);
          return new Response(JSON.stringify({ 
            success: false, 
            error: '404 country not found',
            message: `Country code '${code}' is invalid or unsupported. Use MD, RO, or US.` 
          }), { status: 404, headers: corsHeaders });
        }

        currentSession = {
          connected: true,
          countryCode: code,
          assignedNode: COUNTRIES[code],
          connectedSince: Date.now(),
          connectionDurationSeconds: 0
        };

        recordLog('CONNECT', `Successfully connected to gateway node: ${COUNTRIES[code].name} (${code}) [IP: ${COUNTRIES[code].ip}]`);

        return new Response(JSON.stringify({
          success: true,
          message: `Connected successfully to ${COUNTRIES[code].name}`,
          session: currentSession
        }), { headers: corsHeaders });

      } catch (err) {
        recordLog('ERROR', 'Connection exception: ' + err.message);
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: corsHeaders });
      }
    }

    // 8. POST /api/vpn/disconnect
    if (path === '/api/vpn/disconnect' && method === 'POST') {
      recordLog('DISCONNECT', 'VPN tunnel connection terminated by user client.');
      currentSession = {
        connected: false,
        countryCode: null,
        assignedNode: null,
        connectedSince: null,
        connectionDurationSeconds: 12
      };
      return new Response(JSON.stringify({ success: true, message: 'VPN disconnected successfully' }), { headers: corsHeaders });
    }

    // 9. GET /api/vpn/ip
    if (path === '/api/vpn/ip' && method === 'GET') {
      return new Response(JSON.stringify({
        ip: currentSession.connected && currentSession.assignedNode ? currentSession.assignedNode.ip : '127.0.0.1',
        node: currentSession.connected ? currentSession.assignedNode : { name: 'Local Interface', code: 'LOCAL' }
      }), { headers: corsHeaders });
    }

    // 10. Default HTML Preview Dashboard
    return new Response(getHtmlTemplate(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
};

function getHtmlTemplate() {
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atlas VPN Console & Explorer</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script>
    tailwind.config = { darkMode: 'class' };
  </script>
</head>
<body class="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 min-h-full flex flex-col transition-colors duration-200">

  <!-- Header -->
  <header class="bg-indigo-600 dark:bg-indigo-900 text-white shadow-md py-6 px-4 transition-colors duration-200">
    <div class="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
      <div>
        <h1 class="text-3xl font-bold tracking-tight">Atlas VPN Console</h1>
        <p class="text-indigo-100 text-sm mt-1">Endpoints API: <code class="bg-indigo-700 dark:bg-indigo-800 px-2 py-0.5 rounded text-xs">/api/vpn/countries</code></p>
      </div>
      <div class="flex items-center gap-3 w-full md:w-auto">
        <input
          type="text"
          id="search-input"
          placeholder="Search MD, RO, US..."
          class="px-4 py-2 rounded-lg text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-transparent dark:border-slate-700 w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-400 shadow-inner"
        >
        <button
          id="theme-toggle"
          class="p-2 rounded-lg bg-indigo-700 dark:bg-indigo-800 hover:bg-indigo-800 dark:hover:bg-indigo-700 transition-colors text-white shadow cursor-pointer"
          title="Toggle Dark Mode"
        >
          🌙
        </button>
      </div>
    </div>
  </header>

  <!-- Main Section -->
  <main class="max-w-6xl mx-auto px-4 py-8 flex-grow w-full space-y-8">
    
    <!-- Control Panel -->
    <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 border border-slate-200 dark:border-slate-700 transition-colors">
      <div class="flex flex-col md:flex-row justify-between items-center gap-6">
        <div class="space-y-1">
          <div class="flex items-center gap-3">
            <h2 class="text-xl font-bold">VPN Status:</h2>
            <span id="vpn-status-badge" class="px-3 py-1 text-xs font-semibold rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              Disconnected
            </span>
          </div>
          <p class="text-sm text-slate-500 dark:text-slate-400">Assigned IP: <span id="current-ip" class="font-mono font-medium text-indigo-600 dark:text-indigo-400">127.0.0.1 (Local)</span></p>
          <p class="text-sm text-slate-500 dark:text-slate-400">Private Connection Time: <span id="connection-timer" class="font-mono font-medium text-slate-700 dark:text-slate-300">00:00:12</span></p>
        </div>

        <div class="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <select id="vpn-country-select" class="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 focus:outline-none text-sm w-full sm:w-auto">
            <!-- Populated via JS -->
          </select>
          <button
            id="vpn-toggle-btn"
            class="w-full sm:w-auto px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow transition-all cursor-pointer"
          >
            Connect VPN
          </button>
        </div>
      </div>
    </div>

    <!-- Logs Terminal -->
    <div class="bg-slate-900 dark:bg-black rounded-xl border border-slate-800 shadow-inner p-4 font-mono text-xs text-emerald-400">
      <div class="flex justify-between items-center border-b border-slate-800 pb-2 mb-2">
        <span class="text-slate-400 flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Daemon Audit Logs (<a href="/api/vpn/logs" target="_blank" class="text-indigo-400 underline">JSON Endpoint</a>)
        </span>
        <button id="refresh-logs" class="text-slate-400 hover:text-white text-[10px] uppercase tracking-wider cursor-pointer">Sync Logs</button>
      </div>
      <div id="logs-container" class="space-y-1 max-h-40 overflow-y-auto">
        <div>Loading server logs stream...</div>
      </div>
    </div>

    <!-- Countries Grid -->
    <div>
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-2xl font-bold tracking-tight">Active Gateway Nodes (MD, RO, US)</h3>
        <a href="/api/healthz" target="_blank" class="text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-3 py-1 rounded-md border border-indigo-200 dark:border-indigo-800 hover:underline">
          Test Healthz &rarr;
        </a>
      </div>
      <div id="countries-grid" class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <!-- Rendered via JS -->
      </div>
    </div>

  </main>

  <!-- Footer -->
  <footer class="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 py-4 text-center text-xs text-slate-500 dark:text-slate-400 mt-auto">
    Endpoints: 
    <a href="/api/vpn/countries" class="text-indigo-500 underline ml-1" target="_blank">/api/vpn/countries</a> | 
    <a href="/api/vpn/logs" class="text-indigo-500 underline ml-1" target="_blank">/api/vpn/logs</a> | 
    <a href="/api/vpn/activity" class="text-indigo-500 underline ml-1" target="_blank">/api/vpn/activity</a>
  </footer>

  <script>
    let countriesData = [];
    let isConnected = false;
    let timerInterval = null;
    let seconds = 12;

    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      themeToggle.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
    });

    async function fetchAndRenderLogs() {
      try {
        const res = await fetch('/api/vpn/logs');
        const data = await res.json();
        const container = document.getElementById('logs-container');
        container.innerHTML = data.logs.map(l => {
          const time = l.timestamp.split('T')[1].split('.')[0];
          return \`<div>[\${time}] [\${l.type}] \${l.message}</div>\`;
        }).join('');
        container.scrollTop = container.scrollHeight;
      } catch (err) {
        console.error('Failed to update logs stream');
      }
    }

    document.getElementById('refresh-logs').addEventListener('click', fetchAndRenderLogs);

    async function initializeApp() {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch('/api/vpn/countries'),
          fetch('/api/vpn/status')
        ]);
        countriesData = await cRes.json();
        const status = await sRes.json();
        
        renderCountries(countriesData);
        populateDropdown(countriesData);

        if (status.connected) {
          activateUIState(status.assignedNode);
        }
        await fetchAndRenderLogs();
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }

    function renderCountries(list) {
      const grid = document.getElementById('countries-grid');
      grid.innerHTML = list.map(c => \`
        <div class="bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col justify-between hover:border-indigo-500 transition-all">
          <div>
            <div class="flex justify-between items-start">
              <span class="text-3xl">\${c.flag}</span>
              <span class="text-[10px] font-mono bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">\${c.code}</span>
            </div>
            <h4 class="font-bold text-base mt-2">\${c.name}</h4>
            <p class="text-xs text-slate-500 dark:text-slate-400">\${c.region}</p>
          </div>
          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center text-xs">
            <span class="font-mono text-slate-600 dark:text-slate-300">\${c.ip}</span>
            <span class="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded font-medium">\${c.latency}</span>
          </div>
        </div>
      \`).join('');
    }

    function populateDropdown(list) {
      const select = document.getElementById('vpn-country-select');
      select.innerHTML = '';
      list.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.code;
        opt.textContent = \`\${c.flag} \${c.name} (\${c.code}) - \${c.ip}\`;
        select.appendChild(opt);
      });
    }

    function activateUIState(node) {
      isConnected = true;
      const vpnBtn = document.getElementById('vpn-toggle-btn');
      const vpnBadge = document.getElementById('vpn-status-badge');
      const currentIp = document.getElementById('current-ip');

      vpnBtn.textContent = 'Disconnect VPN';
      vpnBtn.className = 'w-full sm:w-auto px-6 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium shadow transition-all cursor-pointer';
      
      vpnBadge.textContent = 'Connected';
      vpnBadge.className = 'px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
      
      currentIp.textContent = \`\${node.ip} (\${node.name} Node)\`;
      
      seconds = 0;
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        seconds++;
        const hrs = String(Math.floor(seconds / 3600)).padStart(2, '0');
        const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
        const secs = String(seconds % 60).padStart(2, '0');
        document.getElementById('connection-timer').textContent = \`\${hrs}:\${mins}:\${secs}\`;
      }, 1000);
    }

    const vpnBtn = document.getElementById('vpn-toggle-btn');
    const selectLocation = document.getElementById('vpn-country-select');

    vpnBtn.addEventListener('click', async () => {
      if (!isConnected) {
        const selectedCode = selectLocation.value;
        try {
          await fetch('/api/test?ms=37');
          const res = await fetch('/api/vpn/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ countryCode: selectedCode })
          });
          const data = await res.json();

          if (res.status === 404) {
            alert(data.message);
            await fetchAndRenderLogs();
            return;
          }

          if (data.success) {
            activateUIState(data.session.assignedNode);
            await fetchAndRenderLogs();
          }
        } catch (err) {
          console.error('Connection request error:', err);
        }
      } else {
        try {
          await fetch('/api/vpn/disconnect', { method: 'POST' });
          isConnected = false;
          vpnBtn.textContent = 'Connect VPN';
          vpnBtn.className = 'w-full sm:w-auto px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow transition-all cursor-pointer';
          
          const vpnBadge = document.getElementById('vpn-status-badge');
          vpnBadge.textContent = 'Disconnected';
          vpnBadge.className = 'px-3 py-1 text-xs font-semibold rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
          
          document.getElementById('current-ip').textContent = '127.0.0.1 (Local)';
          clearInterval(timerInterval);
          document.getElementById('connection-timer').textContent = '00:00:12';
          await fetchAndRenderLogs();
        } catch(e) {
          console.error('Disconnect failed:', e);
        }
      }
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const filtered = countriesData.filter(c => 
        c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query)
      );
      renderCountries(filtered);
    });

    initializeApp();
  </script>
</body>
</html>
`;
}
