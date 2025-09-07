import { gcalCreateEvent } from '../lib/gcal.js';
export async function bookAppointment({ start, durationMin=30, timezone='America/Sao_Paulo', doctorName='' }){
  const end = new Date(new Date(start).getTime() + durationMin*60000).toISOString();
  return gcalCreateEvent({ start, end, timezone, summary: `Consulta Geniumed${doctorName? ' - '+doctorName : ''}` });
}
