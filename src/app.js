const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    status: 'rejected',
    reason: 'Too many requests, please try again later'
  }
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// Placeholder routes (will be implemented in Phase 2)
app.post('/event', (req, res) => {
  res.json({ message: 'Event endpoint - coming in Phase 2' });
});

app.get('/wallet/:player_id', (req, res) => {
  res.json({ message: 'Wallet endpoint - coming in Phase 2' });
});

app.get('/players', (req, res) => {
  res.json({ message: 'Players endpoint - coming in Phase 2' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    status: 'rejected',
    reason: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'rejected',
    reason: 'Endpoint not found'
  });
});

module.exports = app;