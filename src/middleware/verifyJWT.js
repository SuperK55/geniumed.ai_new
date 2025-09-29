import jwt from 'jsonwebtoken';
import { supa } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';

const JWT_SECRET = env.JWT_SECRET || 'geniumed-secret-key-change-in-production';

export const verifyJWT = async (req, res, next) => {
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
          error: 'Invalid token or user not found'
        });
      }

      // Add user info to request object
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || 'owner',
        specialty: user.specialty
      };

      next();
    } catch (jwtError) {
      log.error('JWT verification error:', jwtError);
      return res.status(401).json({
        ok: false,
        error: 'Invalid token'
      });
    }
  } catch (error) {
    log.error('JWT middleware error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Authentication error'
    });
  }
};
