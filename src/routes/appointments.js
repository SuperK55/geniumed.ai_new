import { Router } from 'express';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { verifyJWT } from '../middleware/verifyJWT.js';
import { googleCalendarService } from '../services/googleCalendar.js';

const router = Router();

/**
 * Get all appointments for the authenticated user
 * GET /api/appointments
 */
router.get('/', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get appointments for this business owner
    const { data: appointments, error } = await supa
      .from('appointments')
      .select(`
        *,
        doctors(
          id,
          name,
          specialty
        ),
        leads(
          id,
          name,
          phone,
          email
        )
      `)
      .eq('owner_id', userId)
      .order('start_at', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    // Transform the data to flatten related information
    const transformedAppointments = appointments?.map(appointment => ({
      ...appointment,
      // Map to frontend expected field names
      start_time: appointment.start_at,
      end_time: appointment.end_at,
      patient_name: appointment.leads?.name || 'Unknown Patient',
      patient_email: appointment.leads?.email,
      patient_phone: appointment.leads?.phone,
      doctor_name: appointment.doctors?.name || 'Unknown Doctor',
      doctor_specialty: appointment.doctors?.specialty || '',
      title: `${appointment.appointment_type} - ${appointment.leads?.name || 'Patient'}`,
      description: appointment.notes,
      google_event_id: appointment.gcal_event_id,
      // Remove nested objects
      doctors: undefined,
      leads: undefined
    })) || [];

    res.json({
      ok: true,
      appointments: transformedAppointments
    });

  } catch (error) {
    log.error('Get appointments error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch appointments'
    });
  }
});

/**
 * Create a new appointment
 * POST /api/appointments
 */
router.post('/', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      patient_name,
      patient_email,
      patient_phone,
      doctor_id,
      lead_id,
      title,
      description,
      start_time,
      end_time,
      appointment_type = 'consultation',
      is_telemedicine = false,
      meeting_link,
      office_address,
      price,
      timezone = 'America/Sao_Paulo'
    } = req.body;

    // Validate required fields
    if (!doctor_id || !start_time || !end_time) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: doctor_id, start_time, end_time'
      });
    }

    // Verify doctor belongs to this user
    const { data: doctor, error: doctorError } = await supa
      .from('doctors')
      .select('id, name, google_calendar_id, google_refresh_token')
      .eq('id', doctor_id)
      .eq('owner_id', userId)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found or does not belong to you'
      });
    }

    // Validate appointment time is in the future
    const appointmentStart = new Date(start_time);
    const now = new Date();
    if (appointmentStart <= now) {
      return res.status(400).json({
        ok: false,
        error: 'Appointment time must be in the future'
      });
    }

    // Check availability if Google Calendar is connected
    if (doctor.google_calendar_id && doctor.google_refresh_token) {
      try {
        const endTime = new Date(end_time);
        const availability = await googleCalendarService.getAvailableSlots(
          doctor_id,
          start_time,
          endTime.toISOString()
        );

        // Check if the requested time slot conflicts with busy times
        const requestedStart = new Date(start_time);
        const requestedEnd = new Date(end_time);
        
        const hasConflict = availability.busySlots.some(busySlot => {
          const busyStart = new Date(busySlot.start);
          const busyEnd = new Date(busySlot.end);
          return (requestedStart < busyEnd && requestedEnd > busyStart);
        });

        if (hasConflict) {
          return res.status(409).json({
            ok: false,
            error: 'The requested time slot conflicts with existing appointments',
            availableSlots: availability.availableSlots.slice(0, 10) // Return first 10 available slots
          });
        }

        // Check if the requested time is within doctor's working hours
        const dayName = requestedStart.toLocaleDateString('en-US', { weekday: 'lowercase' });
        const workingHours = availability.workingHours[dayName];
        
        if (!workingHours || !workingHours.enabled) {
          return res.status(400).json({
            ok: false,
            error: `Doctor is not available on ${dayName}`,
            availableSlots: availability.availableSlots.slice(0, 10)
          });
        }

        // Check if requested time falls within any working time slot
        const requestedTimeStr = requestedStart.toTimeString().slice(0, 5); // HH:MM format
        const requestedEndTimeStr = requestedEnd.toTimeString().slice(0, 5);
        
        const isWithinWorkingHours = workingHours.timeSlots?.some(timeSlot => {
          return requestedTimeStr >= timeSlot.start && requestedEndTimeStr <= timeSlot.end;
        });

        if (!isWithinWorkingHours) {
          return res.status(400).json({
            ok: false,
            error: 'The requested time is outside doctor\'s working hours',
            availableSlots: availability.availableSlots.slice(0, 10)
          });
        }

      } catch (availabilityError) {
        log.warn(`Failed to check availability for appointment:`, availabilityError);
        // Continue with appointment creation if availability check fails
      }
    }

    // If lead_id is not provided but we have patient info, try to find or create lead
    let finalLeadId = lead_id;
    if (!lead_id && patient_name) {
      // Try to find existing lead by email or phone
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
        finalLeadId = existingLead.id;
      } else {
        // Create new lead
        const { data: newLead, error: leadError } = await supa
          .from('leads')
          .insert({
            owner_id: userId,
            name: patient_name,
            email: patient_email,
            phone: patient_phone,
            status: 'appointment_scheduled'
          })
          .select('id')
          .single();

        if (leadError) {
          log.warn('Failed to create lead for appointment:', leadError);
        } else {
          finalLeadId = newLead.id;
        }
      }
    }

    // Create appointment in database
    const { data: appointment, error: appointmentError } = await supa
      .from('appointments')
      .insert({
        owner_id: userId,
        lead_id: finalLeadId,
        doctor_id,
        appointment_type,
        start_at: start_time,
        end_at: end_time,
        timezone,
        status: 'scheduled',
        is_telemedicine,
        meeting_link,
        office_address,
        price: price ? parseFloat(price) : null,
        notes: description
      })
      .select()
      .single();

    if (appointmentError) {
      throw new Error(appointmentError.message);
    }

    // Create Google Calendar event if doctor has calendar connected
    let googleEventId = null;
    let googleEventLink = null;
    
    if (doctor.google_calendar_id && doctor.google_refresh_token) {
      try {
        const appointmentData = {
          summary: title || `${appointment_type} - ${patient_name}`,
          description: description || `Appointment with ${patient_name}`,
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
          conferenceData: is_telemedicine && meeting_link ? {
            createRequest: {
              requestId: `appointment-${appointment.id}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          } : undefined
        };

        const googleEvent = await googleCalendarService.createAppointment(doctor_id, appointmentData);
        googleEventId = googleEvent.id;
        googleEventLink = googleEvent.htmlLink;

        // Update appointment with Google Calendar event ID
        await supa
          .from('appointments')
          .update({ gcal_event_id: googleEventId })
          .eq('id', appointment.id);

        log.info(`Google Calendar event created: ${googleEventId} for appointment ${appointment.id}`);
      } catch (calendarError) {
        log.warn(`Failed to create Google Calendar event for appointment ${appointment.id}:`, calendarError);
        // Don't fail the entire appointment creation if Google Calendar fails
      }
    }

    log.info(`Appointment created: ${appointment.id} for doctor ${doctor_id}`);
    
    res.status(201).json({
      ok: true,
      message: 'Appointment created successfully',
      appointment: {
        ...appointment,
        google_event_id: googleEventId,
        google_event_link: googleEventLink
      }
    });

  } catch (error) {
    log.error('Create appointment error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to create appointment'
    });
  }
});

/**
 * Update an appointment
 * PUT /api/appointments/:id
 */
router.put('/:id', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const appointmentId = req.params.id;
    const updateData = req.body;

    // Verify appointment belongs to this user
    const { data: appointment, error: fetchError } = await supa
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .eq('owner_id', userId)
      .single();

    if (fetchError || !appointment) {
      return res.status(404).json({
        ok: false,
        error: 'Appointment not found or access denied'
      });
    }

    // Map frontend field names to database field names
    const mappedUpdateData = {};
    if (updateData.start_time) mappedUpdateData.start_at = updateData.start_time;
    if (updateData.end_time) mappedUpdateData.end_at = updateData.end_time;
    if (updateData.description) mappedUpdateData.notes = updateData.description;
    if (updateData.google_event_id) mappedUpdateData.gcal_event_id = updateData.google_event_id;
    
    // Copy other fields directly
    const directFields = ['appointment_type', 'status', 'is_telemedicine', 'meeting_link', 'office_address', 'price', 'timezone'];
    directFields.forEach(field => {
      if (updateData[field] !== undefined) {
        mappedUpdateData[field] = updateData[field];
      }
    });

    // Update appointment
    const { data: updatedAppointment, error: updateError } = await supa
      .from('appointments')
      .update(mappedUpdateData)
      .eq('id', appointmentId)
      .select()
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    log.info(`Appointment updated: ${appointmentId}`);
    
    res.json({
      ok: true,
      message: 'Appointment updated successfully',
      appointment: updatedAppointment
    });

  } catch (error) {
    log.error('Update appointment error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update appointment'
    });
  }
});

/**
 * Delete an appointment
 * DELETE /api/appointments/:id
 */
router.delete('/:id', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const appointmentId = req.params.id;

    // Verify appointment belongs to this user
    const { data: appointment, error: fetchError } = await supa
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .eq('owner_id', userId)
      .single();

    if (fetchError || !appointment) {
      return res.status(404).json({
        ok: false,
        error: 'Appointment not found or access denied'
      });
    }

    // Delete appointment
    const { error: deleteError } = await supa
      .from('appointments')
      .delete()
      .eq('id', appointmentId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    log.info(`Appointment deleted: ${appointmentId}`);
    
    res.json({
      ok: true,
      message: 'Appointment deleted successfully'
    });

  } catch (error) {
    log.error('Delete appointment error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to delete appointment'
    });
  }
});

export default router;
