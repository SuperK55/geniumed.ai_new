import { gcalCreateEvent } from '../lib/gcal.js';
export async function bookAppointment(p:{doctor_email:string;start:string;durationMin?:number;timezone?:string;}){
  const duration = (p.durationMin ?? 30) * 60000;
  const end = new Date(new Date(p.start).getTime()+duration).toISOString();
  return gcalCreateEvent({ start:p.start, end, timezone: p.timezone ?? 'America/Sao_Paulo', summary:'Consulta Geniumed', attendees:[p.doctor_email] });
}