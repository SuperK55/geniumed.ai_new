import { google } from 'googleapis';
import { env } from '../config/env.js';

export async function gcalCreateEvent(p:{start:string;end:string;summary:string;timezone:string;attendees:string[];}){
  if(!env.GOOGLE_CLIENT_EMAIL||!env.GOOGLE_PRIVATE_KEY||!env.GCAL_CALENDAR_ID) throw new Error('Google Calendar not configured');
  const jwt = new google.auth.JWT(env.GOOGLE_CLIENT_EMAIL, undefined, env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n'), ['https://www.googleapis.com/auth/calendar']);
  const calendar = google.calendar({ version:'v3', auth: jwt });
  const res = await calendar.events.insert({
    calendarId: env.GCAL_CALENDAR_ID,
    requestBody:{
      summary: p.summary,
      start:{dateTime:p.start,timeZone:p.timezone},
      end:{dateTime:p.end,timeZone:p.timezone},
      attendees: p.attendees.map(e=>({email:e})),
      reminders:{useDefault:true}
    },
    sendUpdates:'all'
  });
  return res.data;
}