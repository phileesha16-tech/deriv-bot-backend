const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Deriv Bot Server running', version: '2.0.0' });
});

// Get accounts
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
    if (!response.ok) return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get OTP
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
    if (!response.ok) return res.status(response.status).json({ error: data.errors?.[0]?.message || 'Failed' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Place trade via REST API (bypasses WebSocket issues)
app.post('/api/trade', async (req, res) => {
  const { token, accountId, digit, stake, ticks, symbol } = req.body;
  if (!token || !accountId) return res.status(400).json({ error: 'Token and accountId required' });

  try {
    const fetch = (await import('node-fetch')).default;

    // Step 1: Get proposal
    const proposalRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/proposal`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contract_type: 'DIGITDIFF',
        symbol: symbol || 'R_100',
        duration: ticks || 5,
        duration_unit: 't',
        amount: stake || 1,
        basis: 'stake',
        barrier: digit.toString(),
        currency: 'USD'
      })
    });
    const proposalData = await proposalRes.json();
    console.log('Proposal response:', JSON.stringify(proposalData));

    if (proposalData.errors && proposalData.errors.length > 0) {
      return res.status(400).json({ error: proposalData.errors[0].message });
    }

    const proposalId = proposalData.data?.proposal_id || proposalData.data?.id;
    if (!proposalId) {
      return res.status(400).json({ error: 'No proposal ID received', raw: proposalData });
    }

    // Step 2: Buy the proposal
    const buyRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/contracts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ proposal_id: proposalId })
    });
    const buyData = await buyRes.json();
    console.log('Buy response:', JSON.stringify(buyData));

    if (buyData.errors && buyData.errors.length > 0) {
      return res.status(400).json({ error: buyData.errors[0].message });
    }

    res.json({ success: true, data: buyData.data });
  } catch (err) {
    console.error('Trade error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get contract result
app.get('/api/contract/:accountId/:contractId', async (req, res) => {
  const { token } = req.query;
  const { accountId, contractId } = req.params;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/contracts/${contractId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss'
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get account balance
app.get('/api/balance/:accountId', async (req, res) => {
  const { token } = req.query;
  const { accountId } = req.params;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Deriv-App-ID': '33pQNMCqRHLfXUnMSr1ss'
      }
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
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
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'connected' }));
    }
  });

  derivWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data.toString());
  });

  derivWs.on('close', (code, reason) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason);
  });

  derivWs.on('error', (err) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: 'Deriv connection error: ' + err.message }));
    }
  });

  clientWs.on('message', (data) => {
    if (derivWs.readyState === WebSocket.OPEN) derivWs.send(data.toString());
  });

  clientWs.on('close', () => {
    if (derivWs.readyState === WebSocket.OPEN) derivWs.close();
  });

  clientWs.on('error', () => {
    if (derivWs.readyState === WebSocket.OPEN) derivWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`Deriv Bot Server v2.0 running on port ${PORT}`);
});
