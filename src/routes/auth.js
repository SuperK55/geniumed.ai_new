import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supa } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';

const router = Router();

// JWT secret - in production, use a strong secret from environment variables
const JWT_SECRET = env.JWT_SECRET || 'secret';
const SALT_ROUNDS = 12;

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role || 'admin-business' 
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Sign Up Route
router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, name, role = 'admin-business' } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({
        ok: false,
        error: 'Email, password, and name are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'Password must be at least 8 characters long'
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supa
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        error: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const { data: newUser, error } = await supa
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password_hash: hashedPassword,
        name: name.trim(),
        role: role,
        is_active: true,
        created_at: new Date().toISOString()
      })
      .select('id, email, name, role, is_active, created_at')
      .single();

    if (error) {
      log.error('User creation error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create user account'
      });
    }

    // Generate token
    const token = generateToken(newUser);

    res.status(201).json({
      ok: true,
      message: 'Account created successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role
      },
      token
    });

  } catch (error) {
    log.error('Signup error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Sign In Route
router.post('/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: 'Email and password are required'
      });
    }

    // Find user
    const { data: user, error } = await supa
      .from('users')
      .select('id, email, name, role, password_hash, is_active')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        ok: false,
        error: 'Account has been deactivated. Please contact administrator.'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    await supa
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Generate token
    const token = generateToken(user);

    res.json({
      ok: true,
      message: 'Signed in successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      token
    });

  } catch (error) {
    log.error('Signin error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Verify Token Route
router.get('/auth/verify', authenticateToken, async (req, res) => {
  try {
    // Get fresh user data
    const { data: user, error } = await supa
      .from('users')
      .select('id, email, name, role, is_active')
      .eq('id', req.user.id)
      .single();

    if (error || !user || !user.is_active) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid or expired token'
      });
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    log.error('Token verification error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Sign Out Route (optional - mainly for token blacklisting in advanced setups)
router.post('/auth/signout', authenticateToken, async (req, res) => {
  try {
    // In a more advanced setup, you could blacklist the token here
    // For now, we'll just send a success response
    res.json({
      ok: true,
      message: 'Signed out successfully'
    });
  } catch (error) {
    log.error('Signout error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Middleware to authenticate JWT token
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        ok: false,
        error: 'Invalid or expired token'
      });
    }

    req.user = user;
    next();
  });
}

export default router; 