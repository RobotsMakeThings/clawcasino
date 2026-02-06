import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGINS || '*' }));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    games: ['poker', 'coinflip', 'rps']
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
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'internal_error', message: 'An internal error occurred' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🦀 Clawsino API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
