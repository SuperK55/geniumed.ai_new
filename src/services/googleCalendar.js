import { google } from 'googleapis';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { env } from '../config/env.js';

class GoogleCalendarService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      `${env.APP_BASE_URL}/api/google-calendar/callback`
    );
  }

  /**
   * Get authenticated calendar client for a doctor
   */
  async getCalendarClient(doctorId) {
    try {
      // Get doctor's Google Calendar credentials
      const { data: doctor, error } = await supa
        .from('doctors')
        .select('google_calendar_id, google_refresh_token, google_access_token, google_token_expires_at')
        .eq('id', doctorId)
        .single();

      if (error || !doctor) {
        throw new Error('Doctor not found');
      }

      if (!doctor.google_refresh_token) {
        throw new Error('Google Calendar not connected for this doctor');
      }

      // Set credentials
      this.oauth2Client.setCredentials({
        refresh_token: doctor.google_refresh_token,
        access_token: doctor.google_access_token
      });

      // Check if token needs refresh
      const now = new Date();
      const expiresAt = doctor.google_token_expires_at ? new Date(doctor.google_token_expires_at) : null;

      if (!expiresAt || now >= expiresAt) {
        // Refresh access token
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);

        // Update tokens in database
        await supa
          .from('doctors')
          .update({
            google_access_token: credentials.access_token,
            google_token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null
          })
          .eq('id', doctorId);

        log.info(`Refreshed Google Calendar token for doctor ${doctorId}`);
      }

      return google.calendar({ version: 'v3', auth: this.oauth2Client });

    } catch (error) {
      log.error('Error getting calendar client:', error);
      throw error;
    }
  }

  /**
   * Create an appointment in Google Calendar
   */
  async createAppointment(doctorId, appointmentData) {
    try {
      const calendar = await this.getCalendarClient(doctorId);

      const { data: doctor } = await supa
        .from('doctors')
        .select('google_calendar_id, name')
        .eq('id', doctorId)
        .single();

      // Handle both old format (startTime/endTime) and new format (start.dateTime/end.dateTime)
      let startDateTime, endDateTime, timezone;
      
      if (appointmentData.start && appointmentData.start.dateTime) {
        // New format from consultation endpoint
        startDateTime = appointmentData.start.dateTime;
        endDateTime = appointmentData.end.dateTime;
        timezone = appointmentData.start.timeZone || appointmentData.end.timeZone || 'America/Sao_Paulo';
      } else {
        // Old format from appointments endpoint
        startDateTime = appointmentData.startTime;
        endDateTime = appointmentData.endTime;
        timezone = appointmentData.timezone || 'America/Sao_Paulo';
      }

      log.info('Creating Google Calendar event with:', { startDateTime, endDateTime, timezone });

      const event = {
        summary: appointmentData.summary || appointmentData.title || `Consulta com ${appointmentData.patientName || 'Paciente'}`,
        description: appointmentData.description || `Consulta médica com ${appointmentData.patientName || 'Paciente'}`,
        start: {
          dateTime: startDateTime,
          timeZone: timezone
        },
        end: {
          dateTime: endDateTime,
          timeZone: timezone
        },
        attendees: appointmentData.attendees || [],
        location: appointmentData.location || appointmentData.office_address,
        conferenceData: appointmentData.conferenceData,
        reminders: appointmentData.reminders || {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 1 day before
            { method: 'popup', minutes: 60 } // 1 hour before
          ]
        },
        colorId: '9' // Blue color for medical appointments
      };

      const response = await calendar.events.insert({
        calendarId: doctor.google_calendar_id,
        resource: event,
        sendUpdates: 'all' // Send email notifications to attendees
      });

      log.info(`Created Google Calendar event ${response.data.id} for doctor ${doctorId}`);

      // Update last sync timestamp
      await supa
        .from('doctors')
        .update({ last_calendar_sync: new Date().toISOString() })
        .eq('id', doctorId);

      return response.data;

    } catch (error) {
      log.error('Error creating appointment in Google Calendar:', error);
      throw error;
    }
  }

  /**
   * Update an appointment in Google Calendar
   */
  async updateAppointment(doctorId, eventId, updates) {
    try {
      const calendar = await this.getCalendarClient(doctorId);

      const { data: doctor } = await supa
        .from('doctors')
        .select('google_calendar_id')
        .eq('id', doctorId)
        .single();

      const event = {};
      if (updates.title) event.summary = updates.title;
      if (updates.description) event.description = updates.description;
      if (updates.startTime) {
        event.start = {
          dateTime: updates.startTime,
          timeZone: updates.timezone || 'America/Sao_Paulo'
        };
      }
      if (updates.endTime) {
        event.end = {
          dateTime: updates.endTime,
          timeZone: updates.timezone || 'America/Sao_Paulo'
        };
      }

      const response = await calendar.events.patch({
        calendarId: doctor.google_calendar_id,
        eventId: eventId,
        resource: event,
        sendUpdates: 'all'
      });

      log.info(`Updated Google Calendar event ${eventId} for doctor ${doctorId}`);

      await supa
        .from('doctors')
        .update({ last_calendar_sync: new Date().toISOString() })
        .eq('id', doctorId);

      return response.data;

    } catch (error) {
      log.error('Error updating appointment in Google Calendar:', error);
      throw error;
    }
  }

  /**
   * Delete an appointment from Google Calendar
   */
  async deleteAppointment(doctorId, eventId) {
    try {
      const calendar = await this.getCalendarClient(doctorId);

      const { data: doctor } = await supa
        .from('doctors')
        .select('google_calendar_id')
        .eq('id', doctorId)
        .single();

      await calendar.events.delete({
        calendarId: doctor.google_calendar_id,
        eventId: eventId,
        sendUpdates: 'all'
      });

      log.info(`Deleted Google Calendar event ${eventId} for doctor ${doctorId}`);

      await supa
        .from('doctors')
        .update({ last_calendar_sync: new Date().toISOString() })
        .eq('id', doctorId);

    } catch (error) {
      log.error('Error deleting appointment from Google Calendar:', error);
      throw error;
    }
  }

  /**
   * Get available time slots for a doctor
   */
  async getAvailableSlots(doctorId, startDate, endDate) {
    try {
      // Validate input parameters
      if (!doctorId || !startDate || !endDate) {
        throw new Error('Missing required parameters: doctorId, startDate, endDate');
      }

      // Validate date format
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Invalid date format. Use ISO 8601 format');
      }

      if (start >= end) {
        throw new Error('startDate must be before endDate');
      }

      const calendar = await this.getCalendarClient(doctorId);

      const { data: doctor, error: doctorError } = await supa
        .from('doctors')
        .select('google_calendar_id, working_hours, date_specific_availability, consultation_duration, timezone')
        .eq('id', doctorId)
        .single();

      if (doctorError) {
        log.error('Database error fetching doctor:', doctorError);
        throw new Error(`Database error: ${doctorError.message}`);
      }

      if (!doctor) {
        throw new Error('Doctor not found');
      }

      if (!doctor.google_calendar_id) {
        throw new Error('Google Calendar not connected for this doctor');
      }

      // Get busy times from Google Calendar
      let busySlots = [];
      if (doctor.google_calendar_id) {
        try {
          const response = await calendar.freebusy.query({
            resource: {
              timeMin: startDate,
              timeMax: endDate,
              timeZone: doctor.timezone || 'America/Sao_Paulo',
              items: [{ id: doctor.google_calendar_id }]
            }
          });

          busySlots = response.data.calendars[doctor.google_calendar_id]?.busy || [];
        } catch (calendarError) {
          log.warn(`Failed to get Google Calendar busy slots for doctor ${doctorId}:`, calendarError);
          // Continue without Google Calendar data
        }
      }

      // Process working hours and date-specific availability to generate available slots
      const availableSlots = this.generateAvailableSlots(
        startDate,
        endDate,
        doctor.working_hours || {},
        doctor.date_specific_availability || [],
        busySlots,
        doctor.consultation_duration || 90,
        doctor.timezone || 'America/Sao_Paulo'
      );

      log.info(`Generated ${availableSlots.length} available slots for doctor ${doctorId}`);

      return {
        availableSlots,
        busySlots,
        workingHours: doctor.working_hours,
        dateSpecificAvailability: doctor.date_specific_availability || [],
        consultationDuration: doctor.consultation_duration || 90,
        timezone: doctor.timezone || 'America/Sao_Paulo'
      };

    } catch (error) {
      log.error('Error getting available slots:', error);
      throw error;
    }
  }

  /**
   * Generate available time slots based on working hours, date-specific availability, and busy slots
   */
  generateAvailableSlots(startDate, endDate, workingHours, dateSpecificAvailability, busySlots, consultationDuration, timezone) {
    try {
      const availableSlots = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      // Validate inputs
      if (!workingHours || typeof workingHours !== 'object') {
        log.warn('Invalid working hours format, using empty object');
        workingHours = {};
      }

      if (!Array.isArray(dateSpecificAvailability)) {
        log.warn('Invalid date specific availability format, using empty array');
        dateSpecificAvailability = [];
      }

      if (!Array.isArray(busySlots)) {
        log.warn('Invalid busy slots format, using empty array');
        busySlots = [];
      }

      if (!consultationDuration || consultationDuration <= 0) {
        log.warn('Invalid consultation duration, using default 90 minutes');
        consultationDuration = 90;
      }
    
    // Convert busy slots to a more usable format
    const busyTimes = busySlots.map(slot => ({
      start: new Date(slot.start),
      end: new Date(slot.end)
    }));

    // Create a map of date-specific availability for quick lookup
    const dateSpecificMap = {};
    dateSpecificAvailability.forEach(entry => {
      const dateKey = entry.date.split('T')[0]; // Get YYYY-MM-DD part
      dateSpecificMap[dateKey] = entry;
    });

    // Generate slots for each day in the range
    for (let currentDate = new Date(start); currentDate <= end; currentDate.setDate(currentDate.getDate() + 1)) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const dayName = currentDate.toLocaleDateString('en-US', { weekday: 'lowercase' });
      
      // Check if this date has specific availability rules
      const dateSpecific = dateSpecificMap[dateKey];
      
      if (dateSpecific && dateSpecific.type === 'unavailable') {
        // Skip this date entirely
        continue;
      }

      // Get working hours for this day
      let dayWorkingHours = [];
      
      if (dateSpecific && dateSpecific.type === 'modified_hours') {
        // Use modified hours for this specific date
        if (dateSpecific.start && dateSpecific.end) {
          dayWorkingHours = [{
            start: dateSpecific.start,
            end: dateSpecific.end
          }];
        }
      } else if (workingHours[dayName] && workingHours[dayName].enabled) {
        // Use regular working hours for this day
        dayWorkingHours = workingHours[dayName].timeSlots || [];
      }

      // Generate time slots for this day
      dayWorkingHours.forEach(timeSlot => {
        const slotStart = new Date(currentDate);
        const slotEnd = new Date(currentDate);
        
        // Parse time strings (HH:MM format)
        const [startHour, startMinute] = timeSlot.start.split(':').map(Number);
        const [endHour, endMinute] = timeSlot.end.split(':').map(Number);
        
        slotStart.setHours(startHour, startMinute, 0, 0);
        slotEnd.setHours(endHour, endMinute, 0, 0);

        // Generate consultation slots within this time range
        let currentSlotStart = new Date(slotStart);
        
        while (currentSlotStart < slotEnd) {
          const currentSlotEnd = new Date(currentSlotStart.getTime() + consultationDuration * 60000);
          
          // Check if this slot would exceed the working hours
          if (currentSlotEnd > slotEnd) {
            break;
          }

          // Check if this slot conflicts with any busy times
          const isBusy = busyTimes.some(busyTime => {
            return (currentSlotStart < busyTime.end && currentSlotEnd > busyTime.start);
          });

          if (!isBusy) {
            availableSlots.push({
              start: currentSlotStart.toISOString(),
              end: currentSlotEnd.toISOString(),
              duration: consultationDuration,
              date: dateKey,
              timeSlot: {
                start: timeSlot.start,
                end: timeSlot.end
              }
            });
          }

          // Move to next slot (default 30-minute increments)
          currentSlotStart.setMinutes(currentSlotStart.getMinutes() + 30);
        }
      });
    }

    return availableSlots;
    } catch (error) {
      log.error('Error generating available slots:', error);
      // Return empty array if slot generation fails
      return [];
    }
  }

  /**
   * List upcoming appointments for a doctor
   */
  async listUpcomingAppointments(doctorId, maxResults = 10) {
    try {
      const calendar = await this.getCalendarClient(doctorId);

      const { data: doctor } = await supa
        .from('doctors')
        .select('google_calendar_id')
        .eq('id', doctorId)
        .single();

      const response = await calendar.events.list({
        calendarId: doctor.google_calendar_id,
        timeMin: new Date().toISOString(),
        maxResults: maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      });

      return response.data.items || [];

    } catch (error) {
      log.error('Error listing upcoming appointments:', error);
      throw error;
    }
  }
}

export const googleCalendarService = new GoogleCalendarService();

