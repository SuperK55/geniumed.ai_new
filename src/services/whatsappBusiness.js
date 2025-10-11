import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { env } from '../config/env.js';
import crypto from 'crypto';

/**
 * WhatsApp Business API Service
 * Handles sending messages and managing WhatsApp Business API integration
 */
class WhatsAppBusinessService {
  constructor() {
    this.apiVersion = 'v18.0';
    this.baseUrl = 'https://graph.facebook.com';
  }

  /**
   * Get WhatsApp Business credentials for a user
   */
  async getWhatsAppCredentials(userId) {
    try {
      const { data: user, error } = await supa
        .from('users')
        .select('whatsapp_phone_id, whatsapp_access_token, whatsapp_phone_number, whatsapp_connected, whatsapp_verified')
        .eq('id', userId)
        .single();

      if (error) {
        throw new Error(`Failed to get WhatsApp credentials: ${error.message}`);
      }

      if (!user.whatsapp_connected) {
        throw new Error('WhatsApp Business not connected for this user');
      }

      if (!user.whatsapp_phone_id || !user.whatsapp_access_token) {
        throw new Error('WhatsApp Business credentials missing');
      }

      return {
        phoneId: user.whatsapp_phone_id,
        accessToken: user.whatsapp_access_token,
        phoneNumber: user.whatsapp_phone_number,
        verified: user.whatsapp_verified
      };
    } catch (error) {
      log.error('Error getting WhatsApp credentials:', error);
      throw error;
    }
  }

  /**
   * Send a text message via WhatsApp Business API
   */
  async sendTextMessage(userId, toNumber, message) {
    try {
      const credentials = await this.getWhatsAppCredentials(userId);

      const response = await fetch(
        `${this.baseUrl}/${this.apiVersion}/${credentials.phoneId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: toNumber,
            type: 'text',
            text: {
              preview_url: false,
              body: message
            }
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
      }

      log.info(`WhatsApp message sent successfully to ${toNumber}`, {
        messageId: data.messages?.[0]?.id,
        userId
      });

      return {
        success: true,
        messageId: data.messages?.[0]?.id,
        data
      };

    } catch (error) {
      log.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }

  /**
   * Send a template message via WhatsApp Business API
   */
  async sendTemplateMessage(userId, toNumber, templateName, languageCode = 'en', components = []) {
    try {
      const credentials = await this.getWhatsAppCredentials(userId);

      const response = await fetch(
        `${this.baseUrl}/${this.apiVersion}/${credentials.phoneId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toNumber,
            type: 'template',
            template: {
              name: templateName,
              language: {
                code: languageCode
              },
              components: components
            }
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
      }

      log.info(`WhatsApp template message sent successfully to ${toNumber}`, {
        messageId: data.messages?.[0]?.id,
        template: templateName,
        userId
      });

      return {
        success: true,
        messageId: data.messages?.[0]?.id,
        data
      };

    } catch (error) {
      log.error('Error sending WhatsApp template message:', error);
      throw error;
    }
  }

  /**
   * Send appointment confirmation via WhatsApp
   */
  async sendAppointmentConfirmation(userId, patientPhone, appointmentDetails) {
    try {
      const { patientName, doctorName, appointmentDate, appointmentTime, location } = appointmentDetails;

      const message = `Hi ${patientName}! 👋\n\nYour appointment is confirmed:\n\n📅 Date: ${appointmentDate}\n⏰ Time: ${appointmentTime}\n👨‍⚕️ Doctor: ${doctorName}\n📍 Location: ${location}\n\nPlease arrive 10 minutes early. If you need to reschedule, please let us know.\n\nSee you soon!`;

      return await this.sendTextMessage(userId, patientPhone, message);

    } catch (error) {
      log.error('Error sending appointment confirmation:', error);
      throw error;
    }
  }

  /**
   * Send appointment reminder via WhatsApp
   */
  async sendAppointmentReminder(userId, patientPhone, reminderDetails) {
    try {
      const { patientName, doctorName, appointmentTime, location } = reminderDetails;

      const message = `Hi ${patientName}! 🔔\n\nReminder: You have an appointment tomorrow with Dr. ${doctorName}\n\n⏰ Time: ${appointmentTime}\n📍 Location: ${location}\n\nWe look forward to seeing you!`;

      return await this.sendTextMessage(userId, patientPhone, message);

    } catch (error) {
      log.error('Error sending appointment reminder:', error);
      throw error;
    }
  }

  /**
   * Send telemedicine meeting link via WhatsApp
   */
  async sendMeetingLink(userId, patientPhone, meetingDetails) {
    try {
      const { patientName, doctorName, meetingLink, appointmentTime } = meetingDetails;

      const message = `Hi ${patientName}! 💻\n\nYour telemedicine appointment with Dr. ${doctorName} is scheduled for ${appointmentTime}\n\n🔗 Join the meeting: ${meetingLink}\n\nPlease join 5 minutes before the scheduled time.\n\nSee you online!`;

      return await this.sendTextMessage(userId, patientPhone, message);

    } catch (error) {
      log.error('Error sending meeting link:', error);
      throw error;
    }
  }

  /**
   * Store WhatsApp Business credentials
   */
  async storeWhatsAppCredentials(userId, credentials) {
    try {
      const { phoneId, accessToken, businessAccountId, phoneNumber, displayPhoneNumber, verified } = credentials;

      // Generate webhook verify token
      const webhookVerifyToken = crypto.randomBytes(32).toString('hex');

      const { data, error } = await supa
        .from('users')
        .update({
          whatsapp_phone_id: phoneId,
          whatsapp_access_token: accessToken,
          whatsapp_business_account_id: businessAccountId,
          whatsapp_phone_number: phoneNumber,
          whatsapp_phone_number_display: displayPhoneNumber || phoneNumber,
          whatsapp_verified: verified || false,
          whatsapp_connected: true,
          whatsapp_connected_at: new Date().toISOString(),
          whatsapp_webhook_verify_token: webhookVerifyToken
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to store WhatsApp credentials: ${error.message}`);
      }

      log.info(`WhatsApp Business connected successfully for user ${userId}`, {
        phoneNumber,
        phoneId
      });

      return {
        success: true,
        webhookVerifyToken,
        data
      };

    } catch (error) {
      log.error('Error storing WhatsApp credentials:', error);
      throw error;
    }
  }

  /**
   * Disconnect WhatsApp Business account
   */
  async disconnectWhatsApp(userId) {
    try {
      const { data, error } = await supa
        .from('users')
        .update({
          whatsapp_phone_id: null,
          whatsapp_access_token: null,
          whatsapp_business_account_id: null,
          whatsapp_phone_number: null,
          whatsapp_phone_number_display: null,
          whatsapp_verified: false,
          whatsapp_connected: false,
          whatsapp_connected_at: null,
          whatsapp_webhook_verify_token: null
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to disconnect WhatsApp: ${error.message}`);
      }

      log.info(`WhatsApp Business disconnected for user ${userId}`);

      return { success: true, data };

    } catch (error) {
      log.error('Error disconnecting WhatsApp:', error);
      throw error;
    }
  }

  /**
   * Get WhatsApp connection status
   */
  async getConnectionStatus(userId) {
    try {
      const { data: user, error } = await supa
        .from('users')
        .select('whatsapp_connected, whatsapp_verified, whatsapp_phone_number_display, whatsapp_connected_at')
        .eq('id', userId)
        .single();

      if (error) {
        throw new Error(`Failed to get connection status: ${error.message}`);
      }

      return {
        connected: user.whatsapp_connected || false,
        verified: user.whatsapp_verified || false,
        phoneNumber: user.whatsapp_phone_number_display || null,
        connectedAt: user.whatsapp_connected_at || null
      };

    } catch (error) {
      log.error('Error getting WhatsApp connection status:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature from Meta
   */
  verifyWebhookSignature(signature, body, appSecret) {
    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(body)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha256=${expectedSignature}`)
    );
  }
}

export const whatsappBusinessService = new WhatsAppBusinessService();

