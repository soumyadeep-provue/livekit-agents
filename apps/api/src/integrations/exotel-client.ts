/**
 * Exotel API Client
 *
 * Handles interaction with Exotel's Exophone (virtual number) API
 * for provisioning and managing Indian virtual phone numbers.
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

export interface AvailablePhone {
  phone_number: string;
  friendly_name: string;
  capabilities: {
    voice: boolean;
    sms: boolean;
  };
  country: string;
  region: string;
}

export interface OutboundCallResponse {
  Call: {
    Sid: string;
    ParentCallSid: string | null;
    DateCreated: string;
    DateUpdated: string;
    AccountSid: string;
    To: string;
    From: string;
    PhoneNumberSid: string;
    Status: string;
    StartTime: string | null;
    EndTime: string | null;
    Duration: number | null;
    Price: number | null;
    Direction: string;
    AnsweredBy: string | null;
    ForwardedFrom: string | null;
    CallerName: string | null;
    Uri: string;
    RecordingUrl: string | null;
  };
}

export class ExotelClient {
  private config: ExotelConfig;
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ExotelConfig) {
    this.config = config;
    // Try v1 API as v2_beta might not be available for all accounts
    // You can switch between v1 and v2_beta based on your account type
    this.baseUrl = `https://${config.subdomain}/v1/Accounts/${config.accountSid}`;

    // Create basic auth header
    const credentials = Buffer.from(`${config.apiKey}:${config.apiToken}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;

    console.log(`🔧 ExotelClient initialized with baseUrl: ${this.baseUrl}`);
  }

  /**
   * Search for available Exophones (virtual numbers) in a specific region
   * @param region Indian telecom circle (MH, DL, KA, etc.)
   * @returns List of available phone numbers
   */
  async searchAvailableNumbers(region: string = 'MH'): Promise<AvailablePhone[]> {
    const url = `${this.baseUrl}/AvailablePhoneNumbers?InRegion=${region}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/xml',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to search available numbers: ${response.status} ${errorText}`);
    }

    const responseText = await response.text();
    
    // Exotel v1 API returns XML
    try {
      const xmlResult = await parseXml(responseText) as any;
      
      // Extract available phones from XML
      const exophones = xmlResult?.TwilioResponse?.ExoPhones?.[0]?.ExoPhone || 
                        xmlResult?.ExoPhones?.[0]?.ExoPhone || 
                        [];
      
      const phones: AvailablePhone[] = Array.isArray(exophones)
        ? exophones.map((phone: any) => ({
            phone_number: phone.PhoneNumber?.[0] || phone.phone_number?.[0] || '',
            friendly_name: phone.FriendlyName?.[0] || phone.friendly_name?.[0] || '',
            capabilities: {
              voice: phone.Capabilities?.[0]?.Voice?.[0] === 'true' || true,
              sms: phone.Capabilities?.[0]?.SMS?.[0] === 'true' || true,
            },
            country: phone.Country?.[0] || 'IN',
            region: phone.Region?.[0] || region,
          }))
        : [];
      
      return phones;
    } catch (parseError) {
      console.error('[Exotel] Failed to parse XML in searchAvailableNumbers:', parseError);
      // Try JSON as fallback
      try {
        const jsonData = JSON.parse(responseText) as { ExoPhones: AvailablePhone[] };
        return jsonData.ExoPhones || [];
      } catch (jsonError) {
        throw new Error(`Failed to parse Exotel response: ${responseText.substring(0, 500)}`);
      }
    }
  }

  /**
   * Buy/purchase an Exophone (virtual number)
   * @param phoneNumber The phone number to purchase (E.164 format: +919876543210)
   * @param friendlyName A friendly name for the number
   * @returns Purchased Exophone details
   */
  async buyNumber(phoneNumber: string, friendlyName: string): Promise<ExophoneResponse> {
    const url = `${this.baseUrl}/IncomingPhoneNumbers`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        PhoneNumber: phoneNumber,
        FriendlyName: friendlyName,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to buy number: ${response.status} ${errorText}`);
    }

    const responseText = await response.text();
    
    // Exotel v1 API returns XML
    try {
      const xmlResult = await parseXml(responseText) as any;
      const numData = xmlResult?.TwilioResponse?.IncomingPhoneNumber?.[0] || xmlResult?.IncomingPhoneNumber?.[0];
      
      if (!numData) {
        throw new Error('Invalid response format from Exotel');
      }
      
      return {
        IncomingPhoneNumber: {
          Sid: numData.Sid?.[0] || numData.sid?.[0] || '',
          PhoneNumber: numData.PhoneNumber?.[0] || numData.phone_number?.[0] || phoneNumber,
          FriendlyName: numData.FriendlyName?.[0] || numData.friendly_name?.[0] || friendlyName,
          Capabilities: {
            Voice: numData.Capabilities?.[0]?.Voice?.[0] === 'true' || true,
            SMS: numData.Capabilities?.[0]?.SMS?.[0] === 'true' || true,
          },
          DateCreated: numData.DateCreated?.[0] || new Date().toISOString(),
          DateUpdated: numData.DateUpdated?.[0] || new Date().toISOString(),
        }
      };
    } catch (parseError) {
      // Try JSON as fallback
      try {
        return JSON.parse(responseText) as ExophoneResponse;
      } catch (jsonError) {
        throw new Error(`Failed to parse Exotel response: ${responseText.substring(0, 200)}`);
      }
    }
  }

  /**
   * Get details of a specific Exophone
   * @param exophoneSid The Exophone SID
   * @returns Exophone details
   */
  async getNumber(exophoneSid: string): Promise<ExophoneResponse> {
    const url = `${this.baseUrl}/IncomingPhoneNumbers/${exophoneSid}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get number: ${response.status} ${errorText}`);
    }

    return await response.json() as ExophoneResponse;
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

  /**
   * Update an Exophone's configuration
   * @param exophoneSid The Exophone SID
   * @param friendlyName New friendly name
   * @returns Updated Exophone details
   */
  async updateNumber(exophoneSid: string, friendlyName: string): Promise<ExophoneResponse> {
    const url = `${this.baseUrl}/IncomingPhoneNumbers/${exophoneSid}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        FriendlyName: friendlyName,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update number: ${response.status} ${errorText}`);
    }

    return await response.json() as ExophoneResponse;
  }

  /**
   * Release/delete an Exophone (virtual number)
   * Note: This permanently releases the number back to the pool
   * @param exophoneSid The Exophone SID to release
   */
  // async releaseNumber(exophoneSid: string): Promise<void> {
  //   const url = `${this.baseUrl}/IncomingPhoneNumbers/${exophoneSid}`;

  //   const response = await fetch(url, {
  //     method: 'DELETE',
  //     headers: {
  //       'Authorization': this.authHeader,
  //     },
  //   });

  //   if (!response.ok && response.status !== 202) {
  //     const errorText = await response.text();
  //     throw new Error(`Failed to release number: ${response.status} ${errorText}`);
  //   }
  // }

  /**
   * Place an outbound call using Exotel's Call API
   * This initiates a call to a customer and connects them to a SIP endpoint (LiveKit room)
   *
   * @param fromNumber Your Exophone (e.g., "+9102247790694")
   * @param toNumber Customer's phone number (E.164 format: "+919876543210")
   * @param sipUri SIP URI to connect the call to (e.g., "sip:room-name@sip-xxx.livekit.cloud")
   * @returns Call details including SID for tracking
   */
  async placeOutboundCall(
    fromNumber: string,
    toNumber: string,
    sipUri: string
  ): Promise<OutboundCallResponse> {
    // Validate and format phone numbers
    // Exotel expects numbers in specific formats based on account settings
    const formatPhoneForExotel = (phone: string): string => {
      // Remove any spaces or special characters
      let formatted = phone.replace(/[\s\-\(\)]/g, '');

      // Remove + prefix if present
      formatted = formatted.replace(/^\+/, '');

      // If it's a 10-digit Indian number without country code, add 91
      if (formatted.length === 10 && !formatted.startsWith('91')) {
        formatted = '91' + formatted;
      }

      // For v1 API, Exotel typically expects numbers with 0 prefix
      // But NOT for already prefixed international format numbers
      // Only add 0 if it's a local Indian mobile number (10 digits)
      if (formatted.length === 10 && !formatted.startsWith('0')) {
        formatted = '0' + formatted;
      }

      return formatted;
    };

    // For Exophone (From number), use as-is if it starts with 0 or has special format
    const formattedFrom = fromNumber.startsWith('0') || fromNumber.length <= 11
      ? fromNumber.replace(/^\+/, '')  // Just remove + if present
      : formatPhoneForExotel(fromNumber);

    const formattedTo = formatPhoneForExotel(toNumber);

    const url = `${this.baseUrl}/Calls/connect`;

    // Log the request details for debugging
    console.log('📞 Exotel API Request:');
    console.log(`   URL: ${url}`);
    console.log(`   From (original): ${fromNumber}`);
    console.log(`   From (formatted): ${formattedFrom}`);
    console.log(`   To (original): ${toNumber}`);
    console.log(`   To (formatted): ${formattedTo}`);
    console.log(`   SIP URI: ${sipUri}`);

    const requestBody = new URLSearchParams({
      From: formattedFrom,
      To: formattedTo,
      ConnectSip: sipUri,
    }).toString();

    console.log(`   Request Body: ${requestBody}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: requestBody,
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error('❌ Exotel API Error:');
      console.error(`   Status: ${response.status}`);
      console.error(`   Response: ${responseText}`);

      // Try to parse error as XML or JSON
      try {
        // Try XML first (v1 API returns XML)
        const xmlResult = await parseXml(responseText) as any;
        if (xmlResult?.RestException) {
          console.error(`   RestException Message: ${xmlResult.RestException.Message?.[0]}`);
          console.error(`   RestException Status: ${xmlResult.RestException.Status?.[0]}`);
        }
      } catch (e) {
        // Try JSON if XML fails
        try {
          const errorJson = JSON.parse(responseText);
          if (errorJson.RestException) {
            console.error(`   RestException Message: ${errorJson.RestException.Message}`);
            console.error(`   RestException Status: ${errorJson.RestException.Status}`);
          }
        } catch (e2) {
          // Neither XML nor JSON, just use raw text
        }
      }

      throw new Error(`Failed to place outbound call: ${response.status} ${responseText}`);
    }

    // Parse successful response (v1 API returns XML)
    try {
      const xmlResult = await parseXml(responseText) as any;

      // Extract call details from XML response
      // Exotel XML structure: <TwilioResponse><Call>...</Call></TwilioResponse>
      const callData = xmlResult?.TwilioResponse?.Call?.[0] || xmlResult?.Call?.[0];

      if (!callData) {
        throw new Error('Invalid response format from Exotel');
      }

      const result: OutboundCallResponse = {
        Call: {
          Sid: callData.Sid?.[0] || callData.sid?.[0],
          ParentCallSid: callData.ParentCallSid?.[0] || null,
          DateCreated: callData.DateCreated?.[0] || new Date().toISOString(),
          DateUpdated: callData.DateUpdated?.[0] || new Date().toISOString(),
          AccountSid: callData.AccountSid?.[0] || this.config.accountSid,
          To: callData.To?.[0] || formattedTo,
          From: callData.From?.[0] || formattedFrom,
          PhoneNumberSid: callData.PhoneNumberSid?.[0] || '',
          Status: callData.Status?.[0] || 'initiated',
          StartTime: callData.StartTime?.[0] || null,
          EndTime: callData.EndTime?.[0] || null,
          Duration: callData.Duration?.[0] || null,
          Price: callData.Price?.[0] || null,
          Direction: callData.Direction?.[0] || 'outbound',
          AnsweredBy: callData.AnsweredBy?.[0] || null,
          ForwardedFrom: callData.ForwardedFrom?.[0] || null,
          CallerName: callData.CallerName?.[0] || null,
          Uri: callData.Uri?.[0] || '',
          RecordingUrl: callData.RecordingUrl?.[0] || null,
        }
      };

      console.log('✅ Exotel call initiated successfully:', result.Call.Sid);
      return result;
    } catch (parseError) {
      console.error('Failed to parse Exotel response:', parseError);
      // Try to parse as JSON as fallback
      try {
        const jsonResult = JSON.parse(responseText) as OutboundCallResponse;
        console.log('✅ Exotel call initiated successfully (JSON):', jsonResult.Call.Sid);
        return jsonResult;
      } catch (jsonError) {
        throw new Error(`Failed to parse Exotel response: ${responseText}`);
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
