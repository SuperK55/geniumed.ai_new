import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supa } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';

const router = Router();

// JWT secret - in production, use a strong secret from environment variables
const JWT_SECRET = env.JWT_SECRET || 'geniumed-secret-key-change-in-production';
const SALT_ROUNDS = 12;

// Helper function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email, 
      role: user.role || 'owner',
      name: user.name,
      specialty: user.specialty
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};

// Business Owner Sign Up Route
router.post('/auth/signup', async (req, res) => {
  try {
    const {
      email,
      password,
      name, 
      phone_number,
      specialty,
      role = 'owner'
    } = req.body;

    // Basic validation
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
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user with simplified fields only
    const { data: newUser, error: userError } = await supa
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password: password_hash,
        name,
        phone_number: phone_number || null,
        role,
        specialty: specialty || '',
        is_active: true
      })
      .select()
      .single();

    if (userError) {
      log.error('User creation error:', userError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create user'
      });
    }

    // Generate JWT token
    const token = generateToken(newUser);

    // Return success response
    const userResponse = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      phone_number: newUser.phone_number,
      role: newUser.role,
      specialty: newUser.specialty,
      social_proof_enabled: newUser.social_proof_enabled,
      social_proof_text: newUser.social_proof_text,
      default_agent_id: newUser.default_agent_id,
      created_at: newUser.created_at
    };

    res.status(201).json({
      ok: true,
      message: 'Account created successfully',
      token,
      user: userResponse
    });

  } catch (error) {
    log.error('Signup error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Sign In Route (updated for business owners)
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
    const { data: user, error: userError } = await supa
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (userError || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid email or password'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
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

    // Generate JWT token
    const token = generateToken(user);

    // Return success response with simplified user data
    const userResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      phone_number: user.phone_number,
      role: user.role,
      specialty: user.specialty,
      social_proof_enabled: user.social_proof_enabled,
      social_proof_text: user.social_proof_text,
      default_agent_id: user.default_agent_id,
      created_at: user.created_at,
      last_login: user.last_login
    };

    res.json({
      ok: true,
      message: 'Login successful',
      token,
      user: userResponse
    });

  } catch (error) {
    log.error('Signin error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Token Verification Route (updated)
router.get('/auth/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Fetch fresh user data
      const { data: user, error: userError } = await supa
        .from('users')
        .select('*')
        .eq('id', decoded.id)
        .eq('is_active', true)
        .single();

      if (userError || !user) {
        return res.status(401).json({
          ok: false,
          error: 'Invalid token'
        });
      }

      const userResponse = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        specialty: user.specialty,
        social_proof_enabled: user.social_proof_enabled,
        social_proof_text: user.social_proof_text,
        default_agent_id: user.default_agent_id
      };

      res.json({
        ok: true,
        user: userResponse
      });

    } catch (jwtError) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid token'
      });
    }

  } catch (error) {
    log.error('Token verification error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Update Profile Route (for business owners)
router.put('/auth/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const {
      name,
      specialty,
      social_proof_enabled,
      social_proof_text,
      default_agent_id
    } = req.body;

    // Build update object with only provided fields
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (specialty !== undefined) updates.specialty = specialty;
    if (social_proof_enabled !== undefined) updates.social_proof_enabled = social_proof_enabled;
    if (social_proof_text !== undefined) updates.social_proof_text = social_proof_text;
    if (default_agent_id !== undefined) {
      // Verify agent belongs to this user if provided
      if (default_agent_id) {
        const { data: agent } = await supa
          .from('agents')
          .select('id')
          .eq('id', default_agent_id)
          .eq('owner_id', decoded.id)
          .eq('is_active', true)
          .single();
        
        if (!agent) {
          return res.status(400).json({
            ok: false,
            error: 'Invalid agent ID or agent does not belong to you'
          });
        }
      }
      updates.default_agent_id = default_agent_id;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No valid fields to update'
      });
    }

    // Update user
    const { data: updatedUser, error: updateError } = await supa
      .from('users')
      .update(updates)
      .eq('id', decoded.id)
      .select()
      .single();

    if (updateError) {
      log.error('Profile update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update profile'
      });
    }

    const userResponse = {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      specialty: updatedUser.specialty,
      social_proof_enabled: updatedUser.social_proof_enabled,
      social_proof_text: updatedUser.social_proof_text,
      default_agent_id: updatedUser.default_agent_id
    };

    res.json({
      ok: true,
      message: 'Profile updated successfully',
      user: userResponse
    });

  } catch (error) {
    log.error('Profile update error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Change Password Route
router.post('/auth/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        ok: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        ok: false,
        error: 'New password must be at least 8 characters long'
      });
    }

    // Get current user
    const { data: user, error: userError } = await supa
      .from('users')
      .select('password_hash')
      .eq('id', decoded.id)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        ok: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        ok: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    const { error: updateError } = await supa
      .from('users')
      .update({ password_hash: newPasswordHash })
      .eq('id', decoded.id);

    if (updateError) {
      log.error('Password update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update password'
      });
    }

    res.json({
      ok: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    log.error('Password change error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Set Default Agent Route
router.post('/auth/set-default-agent', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const { agent_id } = req.body;

    if (!agent_id) {
      return res.status(400).json({
        ok: false,
        error: 'Agent ID is required'
      });
    }

    // Verify agent belongs to this user
    const { data: agent, error: agentError } = await supa
      .from('agents')
      .select('id, name')
      .eq('id', agent_id)
      .eq('owner_id', decoded.id)
      .eq('is_active', true)
      .single();

    if (agentError || !agent) {
      return res.status(400).json({
        ok: false,
        error: 'Agent not found or does not belong to you'
      });
    }

    // Update user's default agent
    const { error: updateError } = await supa
      .from('users')
      .update({ default_agent_id: agent_id })
      .eq('id', decoded.id);

    if (updateError) {
      log.error('Default agent update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to set default agent'
      });
    }

    res.json({
      ok: true,
      message: `Default agent set to ${agent.name}`,
      agent: {
        id: agent.id,
        name: agent.name
      }
    });

  } catch (error) {
    log.error('Set default agent error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Sign Out Route
router.post('/auth/signout', async (req, res) => {
  try {
    // In a more sophisticated implementation, you might want to blacklist the token
    // For now, we'll just return success since JWT tokens are stateless
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

export default router; 