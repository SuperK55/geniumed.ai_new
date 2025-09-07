import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { env } from './config/env.js';
import { log } from './config/logger.js';
import health from './routes/health.js';
import lead from './routes/lead.js';
import retell from './routes/retell.js';
import twilioRoutes from './routes/twilio.js';
import stripeWebhook from './routes/stripe.js';
import functions from './routes/functions.js';
import './scheduler.js';
import { rawBodySaver } from './middleware/rawBody.js';

const app = express();
app.use(bodyParser.json({ type: '*/*', verify: rawBodySaver }));
app.use(cors());

app.use(health);
app.use(lead);
app.use(retell);
app.use(twilioRoutes);
app.use(stripeWebhook);
app.use(functions);

app.use((err:any,_req:any,res:any,_next:any)=>{ log.error(err); res.status(500).json({ error: err?.message || 'server error' }); });

app.listen(env.PORT, () => log.info(`API listening on :${env.PORT}`));