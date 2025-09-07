import type { Request, Response, NextFunction } from 'express';
import { validateRequest } from 'twilio';
import { env } from '../config/env.js';
export function verifyTwilio(req:Request,res:Response,next:NextFunction){
  const signature = String(req.headers['x-twilio-signature']||'');
  const url = `${env.APP_BASE_URL}${req.originalUrl}`;
  if(!validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, req.body)) return res.status(403).send('forbidden');
  next();
}