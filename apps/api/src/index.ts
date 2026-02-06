import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { initDatabase, initDefaultTables } from './db';
import { errorHandler } from './middleware/auth';
import { runBackgroundJobs } from './cron';

// Routes
import authRoutes from './routes/auth';
import agentRoutes from './routes/agents';
import walletRoutes from './routes/wallet';
import pokerRoutes from './routes/poker';
import coinflipRoutes from './routes/coinflip';
import rpsRoutes from './routes/rps';
import adminRoutes from './routes/admin';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/poker', pokerRoutes);
app.use('/api/coinflip', coinflipRoutes);
app.use('/api/rps', rpsRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    version: '1.0.0'
  });
});

// WebSocket
wss.on('connection', (ws) => {
  console.log('WebSocket connected');
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'subscribe' && msg.table_id) {
        ws.send(JSON.stringify({ type: 'subscribed', table_id: msg.table_id }));
      }
    } catch {
      // Invalid message
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket disconnected');
  });
});

// Error handler
app.use(errorHandler);

// Initialize
initDatabase();
initDefaultTables();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🦀 ClawCasino API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

// Run background jobs every 60 seconds
setInterval(runBackgroundJobs, 60000);
console.log('⏰ Background jobs scheduled (every 60s)');
