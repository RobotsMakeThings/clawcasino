import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'clawcasino-jwt-secret-change-me';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      agent?: any;
    }
  }
}

// Auth middleware - verify JWT
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Authorization required' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Get agent from DB
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(decoded.agentId);
    
    if (!agent) {
      res.status(401).json({ error: 'unauthorized', message: 'Agent not found' });
      return;
    }

    req.agent = agent;
    next();
  } catch (error) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}

// Admin auth middleware
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Admin authorization required' });
    return;
  }

  const token = authHeader.slice(7);
  
  if (token !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid admin key' });
    return;
  }

  next();
}

// Rate limiting middleware
const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  // Get identifier (agent ID if authenticated, otherwise IP)
  const identifier = req.agent?.id || req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 100;

  const record = requestCounts.get(identifier);
  
  if (!record || now > record.resetAt) {
    // New window
    requestCounts.set(identifier, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }

  if (record.count >= maxRequests) {
    res.status(429).json({ 
      error: 'rate_limited', 
      message: 'Too many requests. Please slow down.' 
    });
    return;
  }

  record.count++;
  next();
}

// Error handler middleware
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'internal_error', 
    message: 'An internal error occurred' 
  });
}
