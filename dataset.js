// server/rl/dataset.js
// ============================================================
// DATASET CLASS — RL Data Pipeline
// ============================================================
class Dataset {
  constructor() {
    this.data = [];
  }

  add(tick) {
    this.data.push(tick);
  }

  getWindow(size = 50) {
    return this.data.slice(-size);
  }

  buildStates(windowSize = 20) {
    const states = [];
    for (let i = windowSize; i < this.data.length; i++) {
      const window = this.data.slice(i - windowSize, i);
      const features = window.map(t => t.digit);
      states.push({
        state: features,
        next: this.data[i].digit
      });
    }
    return states;
  }
}

module.exports = new Dataset();


// ============================================================
// AI PREDICT ENDPOINT — add to your existing server.js / index.js
// ============================================================
// 
// const Anthropic = require('@anthropic-ai/sdk');
// const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
//
// app.post('/ai-predict', async (req, res) => {
//   const { digits } = req.body;
//   if (!digits || digits.length < 5) {
//     return res.status(400).json({ error: 'Need at least 5 digits' });
//   }
//   try {
//     const response = await client.messages.create({
//       model: 'claude-sonnet-4-20250514',
//       max_tokens: 100,
//       messages: [{
//         role: 'user',
//         content: `You are analyzing Deriv volatility index last digits for pattern prediction.
// Last ${digits.length} digits: [${digits.join(', ')}]
// Based on the sequence, predict the MOST LIKELY next digit (0-9).
// Reply ONLY with valid JSON: {"digit": <number 0-9>, "reasoning": "<one sentence>"}
// No other text.`
//       }]
//     });
//     const text = response.content[0].text.trim();
//     const parsed = JSON.parse(text);
//     if (parsed.digit < 0 || parsed.digit > 9) throw new Error('Invalid digit');
//     res.json(parsed);
//   } catch (e) {
//     // Fallback: return random digit if AI fails
//     res.json({ digit: Math.floor(Math.random() * 10), reasoning: 'fallback random' });
//   }
// });
