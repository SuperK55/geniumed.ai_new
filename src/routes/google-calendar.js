import { Router } from 'express';
import { google } from 'googleapis';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { env } from '../config/env.js';
import { verifyJWT } from '../middleware/verifyJWT.js';
import { googleCalendarService } from '../services/googleCalendar.js';

const router = Router();

// Google OAuth2 Configuration
const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  `${env.APP_BASE_URL}/api/google-calendar/callback`
);

// Scopes for Google Calendar access
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

/**
 * Initiate Google OAuth2 flow for a doctor
 * GET /api/google-calendar/auth/:doctorId
 */
router.get('/auth/:doctorId', verifyJWT, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const userId = req.user.id;

    // Verify doctor belongs to this owner
    const { data: doctor, error: doctorError } = await supa
      .from('doctors')
      .select('id, name')
      .eq('id', doctorId)
      .eq('owner_id', userId)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found or does not belong to you'
      });
    }

    // Generate authorization URL with state parameter
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent', // Force consent screen to get refresh token
      state: JSON.stringify({
        doctorId,
        userId
      })
    });

    res.json({
      ok: true,
      authUrl
    });

  } catch (error) {
    log.error('Google Calendar auth error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to initiate Google Calendar authorization'
    });
  }
});

/**
 * OAuth2 Callback - Handle authorization code
 * GET /api/google-calendar/callback
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      log.error('Google OAuth error:', error);
      return res.redirect(`${env.FRONTEND_URL}/doctors?error=oauth_failed`);
    }

    if (!code || !state) {
      return res.redirect(`${env.FRONTEND_URL}/doctors?error=invalid_callback`);
    }

    // Parse state to get doctor and user IDs
    const { doctorId, userId } = JSON.parse(state);

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user's calendar list to find primary calendar
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calendarListResponse = await calendar.calendarList.list();
    const primaryCalendar = calendarListResponse.data.items.find(cal => cal.primary);

    if (!primaryCalendar) {
      log.error('No primary calendar found for user');
      return res.redirect(`${env.FRONTEND_URL}/doctors?error=no_calendar`);
    }

    // Store tokens in database
    const { error: updateError } = await supa
      .from('doctors')
      .update({
        google_calendar_id: primaryCalendar.id,
        google_refresh_token: tokens.refresh_token,
        google_access_token: tokens.access_token,
        google_token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        calendar_sync_enabled: true,
        last_calendar_sync: new Date().toISOString()
      })
      .eq('id', doctorId)
      .eq('owner_id', userId);

    if (updateError) {
      log.error('Failed to store Google Calendar tokens:', updateError);
      return res.redirect(`${env.FRONTEND_URL}/doctors?error=storage_failed`);
    }

    log.info(`Google Calendar connected for doctor ${doctorId}`);
    res.redirect(`${env.FRONTEND_URL}/doctors?success=calendar_connected`);

  } catch (error) {
    log.error('Google Calendar callback error:', error);
    res.redirect(`${env.FRONTEND_URL}/doctors?error=callback_failed`);
  }
});

/**
 * Disconnect Google Calendar for a doctor
 * DELETE /api/google-calendar/disconnect/:doctorId
 */
router.delete('/disconnect/:doctorId', verifyJWT, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const userId = req.user.id;

    // Verify doctor belongs to this owner
    const { data: doctor, error: doctorError } = await supa
      .from('doctors')
      .select('id, google_refresh_token')
      .eq('id', doctorId)
      .eq('owner_id', userId)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found or does not belong to you'
      });
    }

    // Revoke Google token if exists
    if (doctor.google_refresh_token) {
      try {
        oauth2Client.setCredentials({
          refresh_token: doctor.google_refresh_token
        });
        await oauth2Client.revokeCredentials();
      } catch (revokeError) {
        log.warn('Failed to revoke Google token:', revokeError);
        // Continue anyway to clear from database
      }
    }

    // Clear calendar data from database
    const { error: updateError } = await supa
      .from('doctors')
      .update({
        google_calendar_id: null,
        google_refresh_token: null,
        google_access_token: null,
        google_token_expires_at: null,
        calendar_sync_enabled: false,
        last_calendar_sync: null
      })
      .eq('id', doctorId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    log.info(`Google Calendar disconnected for doctor ${doctorId}`);
    res.json({
      ok: true,
      message: 'Google Calendar disconnected successfully'
    });

  } catch (error) {
    log.error('Google Calendar disconnect error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to disconnect Google Calendar'
    });
  }
});

/**
 * Get calendar connection status for a doctor
 * GET /api/google-calendar/status/:doctorId
 */
router.get('/status/:doctorId', verifyJWT, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const userId = req.user.id;

    const { data: doctor, error } = await supa
      .from('doctors')
      .select('google_calendar_id, calendar_sync_enabled, last_calendar_sync')
      .eq('id', doctorId)
      .eq('owner_id', userId)
      .single();

    if (error || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found'
      });
    }

    res.json({
      ok: true,
      connected: !!doctor.google_calendar_id,
      syncEnabled: doctor.calendar_sync_enabled,
      lastSync: doctor.last_calendar_sync
    });

  } catch (error) {
    log.error('Get calendar status error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get calendar status'
    });
  }
});

/**
 * Get doctor's availability from Google Calendar
 * GET /api/google-calendar/availability/:doctorId
 * Query params: startDate, endDate (ISO 8601 format)
 */
router.get('/availability/:doctorId', verifyJWT, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    // Validate required query parameters
    if (!startDate || !endDate) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required query parameters: startDate and endDate (ISO 8601 format)'
      });
    }

    // Validate date format
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid date format. Use ISO 8601 format (e.g., 2024-01-20T00:00:00-03:00)'
      });
    }

    if (start >= end) {
      return res.status(400).json({
        ok: false,
        error: 'startDate must be before endDate'
      });
    }

    // Verify doctor belongs to this owner and has Google Calendar connected
    const { data: doctor, error: doctorError } = await supa
      .from('doctors')
      .select('id, name, google_calendar_id, google_refresh_token, working_hours, date_specific_availability, consultation_duration, timezone')
      .eq('id', doctorId)
      .eq('owner_id', userId)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found or does not belong to you'
      });
    }

    if (!doctor.google_calendar_id || !doctor.google_refresh_token) {
      return res.status(400).json({
        ok: false,
        error: 'Google Calendar not connected for this doctor'
      });
    }

    // Get availability from Google Calendar
    const availability = await googleCalendarService.getAvailableSlots(
      doctorId,
      startDate,
      endDate
    );

    // Get doctor's working hours and consultation duration for additional context
    const doctorInfo = {
      id: doctor.id,
      name: doctor.name,
      workingHours: doctor.working_hours,
      dateSpecificAvailability: doctor.date_specific_availability || [],
      consultationDuration: doctor.consultation_duration || 90, // default 90 minutes
      timezone: doctor.timezone || 'America/Sao_Paulo'
    };

    log.info(`Retrieved availability for doctor ${doctorId} from ${startDate} to ${endDate}`);

    res.json({
      ok: true,
      doctor: doctorInfo,
      availability: {
        availableSlots: availability.availableSlots,
        busySlots: availability.busySlots,
        workingHours: availability.workingHours,
        dateSpecificAvailability: availability.dateSpecificAvailability,
        consultationDuration: availability.consultationDuration,
        timezone: availability.timezone,
        timeRange: {
          start: startDate,
          end: endDate
        }
      }
    });

  } catch (error) {
    log.error('Get doctor availability error:', error);
    
    // Handle specific Google Calendar errors
    if (error.message?.includes('Google Calendar not connected')) {
      return res.status(400).json({
        ok: false,
        error: 'Google Calendar not connected for this doctor'
      });
    }

    if (error.message?.includes('Doctor not found')) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found'
      });
    }

    if (error.message?.includes('Invalid credentials') || error.message?.includes('unauthorized')) {
      return res.status(401).json({
        ok: false,
        error: 'Google Calendar authentication expired. Please reconnect your calendar.'
      });
    }

    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      return res.status(429).json({
        ok: false,
        error: 'Google Calendar API rate limit exceeded. Please try again later.'
      });
    }

    // Return more detailed error for debugging
    res.status(500).json({
      ok: false,
      error: 'Failed to get doctor availability',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Create a consultation event in Google Calendar
 * POST /api/google-calendar/consultation/:doctorId
 */
router.post('/consultation/:doctorId', verifyJWT, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const userId = req.user.id;
    const {
      patient_name,
      patient_email,
      patient_phone,
      start_time,
      end_time,
      consultation_type = 'consultation',
      notes,
      is_telemedicine = true, // Default to telemedicine for consultations
      meeting_link,
      office_address,
      timezone = 'America/Sao_Paulo'
    } = req.body;

    // Validate required fields
    if (!patient_name || !start_time || !end_time) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: patient_name, start_time, end_time'
      });
    }

    // Validate date format
    const start = new Date(start_time);
    const end = new Date(end_time);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid date format. Use ISO 8601 format (e.g., 2024-01-20T14:00:00-03:00)'
      });
    }

    if (start >= end) {
      return res.status(400).json({
        ok: false,
        error: 'start_time must be before end_time'
      });
    }

    // Verify doctor belongs to this user and has Google Calendar connected
    const { data: doctor, error: doctorError } = await supa
      .from('doctors')
      .select('id, name, google_calendar_id, google_refresh_token, timezone')
      .eq('id', doctorId)
      .eq('owner_id', userId)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found or does not belong to you'
      });
    }

    if (!doctor.google_calendar_id || !doctor.google_refresh_token) {
      return res.status(400).json({
        ok: false,
        error: 'Google Calendar not connected for this doctor'
      });
    }

    // Prepare event data for Google Calendar
    const eventData = {
      summary: `${consultation_type} - ${patient_name}`,
      description: notes || `Consultation with ${patient_name}`,
      start: {
        dateTime: start_time,
        timeZone: timezone
      },
      end: {
        dateTime: end_time,
        timeZone: timezone
      },
      attendees: patient_email ? [{ email: patient_email }] : [],
      location: office_address || undefined,
      conferenceData: is_telemedicine ? {
        createRequest: {
          requestId: `consultation-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      } : undefined,
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 30 }      // 30 minutes before
        ]
      }
    };

    // Create the Google Calendar event
    const googleEvent = await googleCalendarService.createAppointment(doctorId, eventData);

    // Also create a lead record if patient info is provided
    let leadId = null;
    if (patient_name || patient_email || patient_phone) {
      try {
        // Check if lead already exists
        let existingLead = null;
        if (patient_email) {
          const { data: leadByEmail } = await supa
            .from('leads')
            .select('id')
            .eq('email', patient_email)
            .eq('owner_id', userId)
            .single();
          existingLead = leadByEmail;
        }
        
        if (!existingLead && patient_phone) {
          const { data: leadByPhone } = await supa
            .from('leads')
            .select('id')
            .eq('phone', patient_phone)
            .eq('owner_id', userId)
            .single();
          existingLead = leadByPhone;
        }

        if (existingLead) {
          leadId = existingLead.id;
        } else {
          // Create new lead
          const { data: newLead, error: leadError } = await supa
            .from('leads')
            .insert({
              owner_id: userId,
              name: patient_name,
              email: patient_email,
              phone: patient_phone,
              status: 'consultation_scheduled',
              assigned_doctor_id: doctorId
            })
            .select('id')
            .single();

          if (!leadError && newLead) {
            leadId = newLead.id;
          }
        }
      } catch (leadError) {
        log.warn('Failed to create/find lead for consultation:', leadError);
        // Continue without lead creation
      }
    }

    // Create appointment record in database
    let appointmentId = null;
    try {
      const { data: appointment, error: appointmentError } = await supa
        .from('appointments')
        .insert({
          owner_id: userId,
          lead_id: leadId,
          doctor_id: doctorId,
          appointment_type: consultation_type,
          start_at: start_time,
          end_at: end_time,
          timezone,
          status: 'scheduled',
          is_telemedicine,
          meeting_link,
          office_address,
          notes,
          gcal_event_id: googleEvent.id
        })
        .select('id')
        .single();

      if (!appointmentError && appointment) {
        appointmentId = appointment.id;
      }
    } catch (appointmentError) {
      log.warn('Failed to create appointment record:', appointmentError);
      // Continue without appointment record
    }

    log.info(`Consultation event created: ${googleEvent.id} for doctor ${doctorId}`);

    res.status(201).json({
      ok: true,
      message: 'Consultation event created successfully',
      event: {
        id: googleEvent.id,
        htmlLink: googleEvent.htmlLink,
        start: googleEvent.start,
        end: googleEvent.end,
        summary: googleEvent.summary,
        attendees: googleEvent.attendees || [],
        hangoutLink: googleEvent.hangoutLink || null,
        conferenceData: googleEvent.conferenceData || null
      },
      appointment: appointmentId ? { id: appointmentId } : null,
      lead: leadId ? { id: leadId } : null
    });

  } catch (error) {
    log.error('Create consultation event error:', error);
    
    // Handle specific Google Calendar errors
    if (error.message?.includes('Google Calendar not connected')) {
      return res.status(400).json({
        ok: false,
        error: 'Google Calendar not connected for this doctor'
      });
    }

    if (error.message?.includes('Invalid credentials') || error.message?.includes('unauthorized')) {
      return res.status(401).json({
        ok: false,
        error: 'Google Calendar authentication expired. Please reconnect your calendar.'
      });
    }

    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      return res.status(429).json({
        ok: false,
        error: 'Google Calendar API rate limit exceeded. Please try again later.'
      });
    }

    res.status(500).json({
      ok: false,
      error: 'Failed to create consultation event',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;

