import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDatabase } from '../db';

export interface Agent {
  id: string;
  wallet_address: string;
  display_name: string;
  balance_sol: number;
  balance_usdc: number;
  games_played: number;
  total_profit: number;
  created_at?: number;
}

export interface AuthRequest extends Request {
  agent?: Agent;
}

declare global {
  namespace Express {
    interface Request {
      agent?: Agent;
    }
  }
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Bearer token required' });
  }
  
  const token = authHeader.slice(7);
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as {
      agentId: string;
      wallet: string;
    };
    
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(payload.agentId);
    
    if (!agent) {
      return res.status(401).json({ error: 'Unauthorized - Agent not found' });
    }
    
    req.agent = agent;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-admin-key'] || req.query.adminKey;
  
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Forbidden - Admin access required' });
  }
  
  next();
}
