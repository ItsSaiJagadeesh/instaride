/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * The links behind the driver's Call and WhatsApp buttons. Plain functions, so they can be tested on their own.
 * Opening a link only opens the phone dialler or WhatsApp with the text filled in. Nothing is dialled or sent automatically.
 */
const tenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** The greeting comes from the server, which works it out from the rider's own saved gender. */
export function whatsappMessage(greeting: string): string {
  return `${greeting}, I am your InstaDriver. I have accepted your ride request and am on my way to your pickup location. Please let me know if you need any assistance.`;
}

export const telUrl = (phone: string) => `tel:+91${tenDigits(phone)}`;
/** Opens the WhatsApp app directly. */
export const whatsappAppUrl = (phone: string, text: string) => `whatsapp://send?phone=91${tenDigits(phone)}&text=${encodeURIComponent(text)}`;
/** Used when the app link fails: WhatsApp's own web link, which opens WhatsApp or offers to install it. */
export const whatsappWebUrl = (phone: string, text: string) => `https://wa.me/91${tenDigits(phone)}?text=${encodeURIComponent(text)}`;
