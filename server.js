const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'Deriv Bot Server running', version: '3.0.0' });
});

// Get accounts
app.post('/api/accounts', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss' }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get OTP
app.post('/api/otp', async (req, res) => {
  const { token, accountId } = req.body;
  if (!token || !accountId) return res.status(400).json({ error: 'Token and accountId required' });
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss' }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Place trade via server-side WebSocket
app.post('/api/trade', async (req, res) => {
  const { token, accountId, digit, stake, ticks, symbol } = req.body;
  if (!token || !accountId) return res.status(400).json({ error: 'token and accountId required' });

  try {
    // Get fresh OTP before each trade
    const fetch = (await import('node-fetch')).default;
    const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss' }
    });
    const otpData = await otpRes.json();
    if (otpData.errors && otpData.errors.length > 0) {
      return res.status(400).json({ error: otpData.errors[0].message });
    }
    const wsUrl = otpData.data && otpData.data.url;
    if (!wsUrl) return res.status(400).json({ error: 'Could not get WebSocket URL' });
    console.log('Trade OTP URL prefix:', wsUrl.substring(0, 50));

    const ws = new WebSocket(wsUrl);
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        res.status(408).json({ error: 'Connection timeout' });
      }
    }, 15000);

    ws.on('open', () => {
      // Send proposal
      // Map old symbol IDs to new API format
      var symbolMap = {
        'R_10': 'R_10', 'R_25': 'R_25', 'R_50': 'R_50', 'R_75': 'R_75', 'R_100': 'R_100',
        'R_10_1s': '1HZ10V', 'R_25_1s': '1HZ25V', 'R_50_1s': '1HZ50V',
        'R_75_1s': '1HZ75V', 'R_100_1s': '1HZ100V'
      };
      var mappedSymbol = symbolMap[symbol] || symbol || 'R_100';
      console.log('Trading symbol:', symbol, '->', mappedSymbol);

      ws.send(JSON.stringify({
        proposal: 1,
        amount: stake || 1,
        basis: 'stake',
        contract_type: 'DIGITDIFF',
        currency: 'USD',
        duration: ticks || 5,
        duration_unit: 't',
        underlying_symbol: mappedSymbol,
        barrier: digit.toString()
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.msg_type === 'proposal' && msg.proposal && !resolved) {
          // Buy the proposal
          ws.send(JSON.stringify({ buy: msg.proposal.id, price: msg.proposal.ask_price }));
        }
        if (msg.msg_type === 'buy' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          res.json({ success: true, contractId: msg.buy.contract_id, balanceAfter: msg.buy.balance_after });
        }
        if (msg.error && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          res.status(400).json({ error: msg.error.message });
        }
      } catch(e) {}
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        res.status(500).json({ error: 'WebSocket error: ' + err.message });
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check contract result
app.post('/api/contract-result', async (req, res) => {
  const { token, accountId, contractId } = req.body;
  if (!token || !accountId || !contractId) return res.status(400).json({ error: 'token, accountId and contractId required' });

  try {
    // Get fresh OTP
    const fetch = (await import('node-fetch')).default;
    const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss' }
    });
    const otpData = await otpRes.json();
    if (!otpData.data || !otpData.data.url) return res.status(400).json({ error: 'Could not get WebSocket URL' });
    const wsUrl = otpData.data.url;

    const ws = new WebSocket(wsUrl);
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; ws.close(); res.status(408).json({ error: 'Timeout' }); }
    }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          if ((poc.is_expired || poc.is_sold) && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            res.json({ success: true, status: poc.status, payout: poc.payout, balanceAfter: poc.balance_after });
          }
        }
      } catch(e) {}
    });

    ws.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timeout); res.status(500).json({ error: err.message }); }
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// WebSocket proxy
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (clientWs, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/ws?', ''));
  const derivWsUrl = decodeURIComponent(urlParams.get('wsUrl') || '');

  if (!derivWsUrl || !derivWsUrl.startsWith('wss://api.derivws.com')) {
    clientWs.close(1008, 'Invalid WebSocket URL');
    return;
  }

  const derivWs = new WebSocket(derivWsUrl);

  derivWs.on('open', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: 'connected' }));
  });
  derivWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
  });
  derivWs.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      try { clientWs.close(typeof code === 'number' ? code : 1000); } catch(e) {}
    }
  });
  derivWs.on('error', (err) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ error: err.message }));
  });
  clientWs.on('message', (data) => {
    if (derivWs.readyState === WebSocket.OPEN) derivWs.send(data.toString());
  });
  clientWs.on('close', () => { if (derivWs.readyState === WebSocket.OPEN) derivWs.close(); });
  clientWs.on('error', () => { if (derivWs.readyState === WebSocket.OPEN) derivWs.close(); });
});

server.listen(PORT, () => console.log(`Deriv Bot Server v3.0 running on port ${PORT}`));
