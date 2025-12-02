/**
 * Exotel API Client
 *
 * Handles interaction with Exotel's Exophone (virtual number) API
 * for listing owned phone numbers.
 *
 * API Documentation: https://developer.exotel.com/api/exophones
 */

import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXml = promisify(parseString);

export interface ExotelConfig {
  apiKey: string;
  apiToken: string;
  accountSid: string;
  subdomain: string; // e.g., 'api.in.exotel.com' for Mumbai
}

export interface ExophoneResponse {
  IncomingPhoneNumber: {
    Sid: string;
    PhoneNumber: string;
    FriendlyName: string;
    Capabilities: {
      Voice: boolean;
      SMS: boolean;
    };
    DateCreated: string;
    DateUpdated: string;
  };
}

export class ExotelClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ExotelConfig) {
    this.baseUrl = `https://${config.subdomain}/v1/Accounts/${config.accountSid}`;

    // Create basic auth header
    const credentials = Buffer.from(`${config.apiKey}:${config.apiToken}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;

    console.log(`🔧 ExotelClient initialized with baseUrl: ${this.baseUrl}`);
  }

  /**
   * List all Exophones owned by this account
   * @returns List of Exophones
   */
  async listNumbers(): Promise<ExophoneResponse[]> {
    const url = `${this.baseUrl}/IncomingPhoneNumbers`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/xml',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list numbers: ${response.status} ${errorText}`);
    }

    const responseText = await response.text();
    console.log('[Exotel] listNumbers response (first 200 chars):', responseText.substring(0, 200));

    // Exotel v1 API returns XML
    try {
      const xmlResult = await parseXml(responseText) as any;
      console.log('[Exotel] Parsed XML result (full):', JSON.stringify(xmlResult, null, 2));

      // Extract phone numbers from XML response
      // Exotel XML structure can vary:
      // <TwilioResponse><IncomingPhoneNumbers><IncomingPhoneNumber>...</IncomingPhoneNumber></IncomingPhoneNumbers></TwilioResponse>
      // or <IncomingPhoneNumbers><IncomingPhoneNumber>...</IncomingPhoneNumber></IncomingPhoneNumbers>
      let incomingNumbers = xmlResult?.TwilioResponse?.IncomingPhoneNumbers?.[0]?.IncomingPhoneNumber;

      // Handle single number (not array)
      if (incomingNumbers && !Array.isArray(incomingNumbers)) {
        incomingNumbers = [incomingNumbers];
      }

      // Try alternative paths
      if (!incomingNumbers || incomingNumbers.length === 0) {
        incomingNumbers = xmlResult?.IncomingPhoneNumbers?.[0]?.IncomingPhoneNumber;
        if (incomingNumbers && !Array.isArray(incomingNumbers)) {
          incomingNumbers = [incomingNumbers];
        }
      }

      if (!incomingNumbers || incomingNumbers.length === 0) {
        incomingNumbers = xmlResult?.TwilioResponse?.IncomingPhoneNumber;
        if (incomingNumbers && !Array.isArray(incomingNumbers)) {
          incomingNumbers = [incomingNumbers];
        }
      }

      incomingNumbers = incomingNumbers || [];

      console.log('[Exotel] Found', Array.isArray(incomingNumbers) ? incomingNumbers.length : 0, 'phone numbers');
      console.log('[Exotel] XML structure keys:', Object.keys(xmlResult || {}));

      // Convert XML structure to our interface format
      const numbers: ExophoneResponse[] = Array.isArray(incomingNumbers)
        ? incomingNumbers.map((num: any) => ({
            IncomingPhoneNumber: {
              Sid: num.Sid?.[0] || num.sid?.[0] || '',
              PhoneNumber: num.PhoneNumber?.[0] || num.phone_number?.[0] || '',
              FriendlyName: num.FriendlyName?.[0] || num.friendly_name?.[0] || '',
              Capabilities: {
                Voice: num.Capabilities?.[0]?.Voice?.[0] === 'true' || num.Capabilities?.[0]?.voice?.[0] === 'true' || false,
                SMS: num.Capabilities?.[0]?.SMS?.[0] === 'true' || num.Capabilities?.[0]?.sms?.[0] === 'true' || false,
              },
              DateCreated: num.DateCreated?.[0] || num.date_created?.[0] || '',
              DateUpdated: num.DateUpdated?.[0] || num.date_updated?.[0] || '',
            }
          }))
        : [];

      return numbers;
    } catch (parseError) {
      console.error('[Exotel] Failed to parse XML response:', parseError);
      // Try JSON as fallback
      try {
        const jsonData = JSON.parse(responseText) as { IncomingPhoneNumbers: ExophoneResponse[] };
        return jsonData.IncomingPhoneNumbers || [];
      } catch (jsonError) {
        throw new Error(`Failed to parse Exotel response (XML parse error: ${parseError}, JSON parse error: ${jsonError}): ${responseText.substring(0, 500)}`);
      }
    }
  }
}

/**
 * Create an Exotel client from environment variables
 */
export function createExotelClient(): ExotelClient {
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.in.exotel.com';

  if (!apiKey || !apiToken || !accountSid) {
    throw new Error('Missing Exotel environment variables. Required: EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID');
  }

  return new ExotelClient({
    apiKey,
    apiToken,
    accountSid,
    subdomain,
  });
}
