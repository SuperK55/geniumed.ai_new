import type { Request, Response, NextFunction } from 'express';
import { verifyRetellSignature } from '../lib/retell.js';
import { getRawBody } from './rawBody.js';
export function verifyRetell(req:Request,res:Response,next:NextFunction){
  const sig = String(req.headers['x-retell-signature']||'');
  const raw = getRawBody(req).toString();
  if(!verifyRetellSignature(raw, sig)) return res.status(401).send('bad signature');
  next();
}