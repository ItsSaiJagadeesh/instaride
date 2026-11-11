/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Sends text messages. Providers:
 *   SMS_PROVIDER=console  prints the message in the server window (development only, refused in production)
 *   SMS_PROVIDER=twilio   Twilio's REST API (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID)
 * In India, bulk SMS must go through a DLT-registered sender and an approved message template, which
 * your SMS provider helps you set up. Add other providers (MSG91, Gupshup...) in sendSms below.
 */

export class SmsError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const isProd = () => process.env.NODE_ENV === "production";

export function smsProviderName(): string {
  return (process.env.SMS_PROVIDER || (isProd() ? "" : "console")).toLowerCase();
}

/** Called at startup: say clearly what is and is not set up. */
export function describeSmsSetup(): string {
  const p = smsProviderName();
  if (!p) return "SMS: no provider set (SMS_PROVIDER). Sign-in codes can only be sent to the numbers listed in OTP_FIXED.";
  if (p === "console") return "SMS: console mode. Codes are printed in this window and no real SMS is sent.";
  if (p === "twilio") {
    const ok = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID);
    return ok ? "SMS: Twilio." : "SMS: Twilio selected but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID) are not all set.";
  }
  return `SMS: unknown provider "${p}".`;
}

export async function sendSms(phone: string, text: string): Promise<void> {
  const provider = smsProviderName();
  const to = "+91" + phone;

  if (provider === "console") {
    if (isProd()) throw new SmsError("SMS is not set up on this server.", 503);
    console.log(`[SMS to ${to}] ${text}`);
    return;
  }

  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
    if (!sid || !token || !(from || service)) throw new SmsError("SMS is not set up on this server.", 503);
    const base = (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "");
    const body = new URLSearchParams({ To: to, Body: text });
    if (service) body.set("MessagingServiceSid", service);
    else body.set("From", from as string);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) {
        // Never log the message text: it contains the code.
        console.error(`SMS provider refused the message (HTTP ${res.status}).`);
        throw new SmsError("We could not send the code right now. Please try again in a minute.", 502);
      }
      return;
    } catch (e: any) {
      if (e instanceof SmsError) throw e;
      console.error("SMS provider unreachable.");
      throw new SmsError("We could not send the code right now. Please try again in a minute.", 502);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new SmsError("SMS is not set up on this server.", 503);
}
