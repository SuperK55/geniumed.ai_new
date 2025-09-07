import type { Request, Response } from 'express';
export function rawBodySaver(_req: Request, _res: Response, buf: Buffer){ ( _req as any).rawBody = buf; }
export function getRawBody(req: Request){ return (req as any).rawBody || Buffer.from(JSON.stringify(req.body||{})); }