import { Router } from 'express';
import { verifyJWT } from '../middleware/verifyJWT.js';
import { whatsappBusinessService } from '../services/whatsappBusiness.js';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { env } from '../config/env.js';

const router = Router();

/**
 * Get WhatsApp Business connection status
 * GET /api/whatsapp/status
 */
router.get('/status', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;

    const status = await whatsappBusinessService.getConnectionStatus(userId);

    res.json({
      ok: true,
      whatsapp: status
    });

  } catch (error) {
    log.error('Get WhatsApp status error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get WhatsApp connection status'
    });
  }
});

/**
 * Connect WhatsApp Business account
 * POST /api/whatsapp/connect
 * 
 * Body: {
 *   phone_id: "string",
 *   access_token: "string",
 *   business_account_id: "string",
 *   phone_number: "+1234567890",
 *   display_phone_number: "+1 (234) 567-8900",
 *   verified: boolean
 * }
 */
router.post('/connect', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      phone_id,
      access_token,
      business_account_id,
      phone_number,
      display_phone_number,
      verified
    } = req.body;

    // Validate required fields
    if (!phone_id || !access_token || !business_account_id || !phone_number) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: phone_id, access_token, business_account_id, phone_number'
      });
    }

    // Verify the access token is valid by making a test API call
    try {
      const testResponse = await fetch(
        `https://graph.facebook.com/v18.0/${phone_id}`,
        {
          headers: {
            'Authorization': `Bearer ${access_token}`
          }
        }
      );

      if (!testResponse.ok) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid WhatsApp Business credentials. Please check your access token.'
        });
      }
    } catch (verifyError) {
      log.error('Error verifying WhatsApp credentials:', verifyError);
      return res.status(400).json({
        ok: false,
        error: 'Failed to verify WhatsApp Business credentials'
      });
    }

    // Store credentials
    const result = await whatsappBusinessService.storeWhatsAppCredentials(userId, {
      phoneId: phone_id,
      accessToken: access_token,
      businessAccountId: business_account_id,
      phoneNumber: phone_number,
      displayPhoneNumber: display_phone_number,
      verified: verified || false
    });

    res.json({
      ok: true,
      message: 'WhatsApp Business connected successfully',
      whatsapp: {
        connected: true,
        phoneNumber: display_phone_number || phone_number,
        verified: verified || false,
        webhookVerifyToken: result.webhookVerifyToken
      }
    });

  } catch (error) {
    log.error('Connect WhatsApp error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to connect WhatsApp Business account'
    });
  }
});

/**
 * Disconnect WhatsApp Business account
 * POST /api/whatsapp/disconnect
 */
router.post('/disconnect', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;

    await whatsappBusinessService.disconnectWhatsApp(userId);

    res.json({
      ok: true,
      message: 'WhatsApp Business disconnected successfully'
    });

  } catch (error) {
    log.error('Disconnect WhatsApp error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to disconnect WhatsApp Business account'
    });
  }
});

/**
 * Send a WhatsApp message
 * POST /api/whatsapp/send
 * 
 * Body: {
 *   to: "+1234567890",
 *   message: "Hello, this is a test message"
 * }
 */
router.post('/send', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const { to, message } = req.body;

    // Validate required fields
    if (!to || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: to, message'
      });
    }

    // Validate phone number format (basic check)
    if (!to.match(/^\+?[1-9]\d{1,14}$/)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid phone number format. Use E.164 format (+1234567890)'
      });
    }

    const result = await whatsappBusinessService.sendTextMessage(userId, to, message);

    res.json({
      ok: true,
      message: 'WhatsApp message sent successfully',
      messageId: result.messageId
    });

  } catch (error) {
    log.error('Send WhatsApp message error:', error);
    
    if (error.message.includes('not connected')) {
      return res.status(400).json({
        ok: false,
        error: 'WhatsApp Business not connected. Please connect your account first.'
      });
    }

    res.status(500).json({
      ok: false,
      error: 'Failed to send WhatsApp message',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Send appointment confirmation via WhatsApp
 * POST /api/whatsapp/send-appointment-confirmation
 * 
 * Body: {
 *   patient_phone: "+1234567890",
 *   patient_name: "John Doe",
 *   doctor_name: "Dr. Smith",
 *   appointment_date: "January 20, 2024",
 *   appointment_time: "2:00 PM",
 *   location: "123 Main St"
 * }
 */
router.post('/send-appointment-confirmation', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      patient_phone,
      patient_name,
      doctor_name,
      appointment_date,
      appointment_time,
      location
    } = req.body;

    // Validate required fields
    if (!patient_phone || !patient_name || !doctor_name || !appointment_date || !appointment_time) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields'
      });
    }

    const result = await whatsappBusinessService.sendAppointmentConfirmation(userId, patient_phone, {
      patientName: patient_name,
      doctorName: doctor_name,
      appointmentDate: appointment_date,
      appointmentTime: appointment_time,
      location: location || 'Our clinic'
    });

    res.json({
      ok: true,
      message: 'Appointment confirmation sent successfully',
      messageId: result.messageId
    });

  } catch (error) {
    log.error('Send appointment confirmation error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to send appointment confirmation'
    });
  }
});

/**
 * Send telemedicine meeting link via WhatsApp
 * POST /api/whatsapp/send-meeting-link
 * 
 * Body: {
 *   patient_phone: "+1234567890",
 *   patient_name: "John Doe",
 *   doctor_name: "Dr. Smith",
 *   meeting_link: "https://meet.google.com/...",
 *   appointment_time: "2:00 PM"
 * }
 */
router.post('/send-meeting-link', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      patient_phone,
      patient_name,
      doctor_name,
      meeting_link,
      appointment_time
    } = req.body;

    // Validate required fields
    if (!patient_phone || !patient_name || !doctor_name || !meeting_link || !appointment_time) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields'
      });
    }

    const result = await whatsappBusinessService.sendMeetingLink(userId, patient_phone, {
      patientName: patient_name,
      doctorName: doctor_name,
      meetingLink: meeting_link,
      appointmentTime: appointment_time
    });

    res.json({
      ok: true,
      message: 'Meeting link sent successfully',
      messageId: result.messageId
    });

  } catch (error) {
    log.error('Send meeting link error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to send meeting link'
    });
  }
});

/**
 * WhatsApp webhook verification
 * GET /api/whatsapp/webhook
 */
router.get('/webhook', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Check if webhook verification request
    if (mode === 'subscribe' && token) {
      // Verify the token matches our environment variable
      if (token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        log.info('WhatsApp webhook verified successfully');
        return res.status(200).send(challenge);
      } else {
        log.warn('WhatsApp webhook verification failed: invalid token');
        return res.sendStatus(403);
      }
    }

    res.sendStatus(400);

  } catch (error) {
    log.error('WhatsApp webhook verification error:', error);
    res.sendStatus(500);
  }
});

/**
 * WhatsApp webhook handler (incoming messages)
 * POST /api/whatsapp/webhook
 */
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Verify webhook signature
    const signature = req.headers['x-hub-signature-256'];
    if (signature && env.WHATSAPP_APP_SECRET) {
      const isValid = whatsappBusinessService.verifyWebhookSignature(
        signature,
        JSON.stringify(body),
        env.WHATSAPP_APP_SECRET
      );

      if (!isValid) {
        log.warn('WhatsApp webhook signature verification failed');
        return res.sendStatus(403);
      }
    }

    // Process webhook payload
    if (body.object === 'whatsapp_business_account') {
      if (body.entry) {
        for (const entry of body.entry) {
          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.field === 'messages') {
                const value = change.value;
                
                // Handle incoming messages
                if (value.messages) {
                  for (const message of value.messages) {
                    log.info('Received WhatsApp message:', {
                      from: message.from,
                      type: message.type,
                      messageId: message.id
                    });

                    // TODO: Process incoming messages
                    // - Store in database
                    // - Trigger appropriate responses
                    // - Update conversation status
                  }
                }

                // Handle message status updates
                if (value.statuses) {
                  for (const status of value.statuses) {
                    log.info('WhatsApp message status update:', {
                      messageId: status.id,
                      status: status.status,
                      timestamp: status.timestamp
                    });

                    // TODO: Update message delivery status in database
                  }
                }
              }
            }
          }
        }
      }
    }

    // Always respond with 200 to acknowledge receipt
    res.sendStatus(200);

  } catch (error) {
    log.error('WhatsApp webhook handler error:', error);
    // Still return 200 to avoid Meta retrying
    res.sendStatus(200);
  }
});

export default router;

