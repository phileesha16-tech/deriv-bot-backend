const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Deriv Bot Server running', version: '1.0.0' });
});

// ── Step 1: Get accounts list using PAT token ─────────────────────────────────
app.post('/api/accounts', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss'
      }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed to get accounts' });
    }
    res.json(data);
  } catch (err) {
    console.error('Accounts error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ── Step 2: Get OTP for WebSocket connection ──────────────────────────────────
app.post('/api/otp', async (req, res) => {
  const { token, accountId } = req.body;
  if (!token || !accountId) return res.status(400).json({ error: 'Token and accountId required' });

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss'
      }
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed to get OTP' });
    }
    res.json(data);
  } catch (err) {
    console.error('OTP error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// ── Step 3: WebSocket proxy ───────────────────────────────────────────────────
// Client connects to wss://your-server/ws?wsUrl=<encoded_deriv_ws_url>
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (clientWs, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/ws?', ''));
  const derivWsUrl = decodeURIComponent(urlParams.get('wsUrl') || '');

  if (!derivWsUrl || !derivWsUrl.startsWith('wss://api.derivws.com')) {
    clientWs.close(1008, 'Invalid WebSocket URL');
    return;
  }

  console.log('Proxying WebSocket to:', derivWsUrl.substring(0, 60) + '...');

  const derivWs = new WebSocket(derivWsUrl);

  derivWs.on('open', () => {
    console.log('Connected to Deriv WebSocket');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'connected' }));
    }
  });

  derivWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  derivWs.on('close', (code, reason) => {
    console.log('Deriv WS closed:', code);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(code, reason);
    }
  });

  derivWs.on('error', (err) => {
    console.error('Deriv WS error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: 'Deriv connection error: ' + err.message }));
    }
  });

  clientWs.on('message', (data) => {
    if (derivWs.readyState === WebSocket.OPEN) {
      derivWs.send(data.toString());
    }
  });

  clientWs.on('close', () => {
    if (derivWs.readyState === WebSocket.OPEN) {
      derivWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('Client WS error:', err.message);
    if (derivWs.readyState === WebSocket.OPEN) {
      derivWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Deriv Bot Server running on port ${PORT}`);
});
