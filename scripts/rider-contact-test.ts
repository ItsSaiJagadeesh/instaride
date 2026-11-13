// Checks the Call and WhatsApp links (GPL-3.0-or-later). Run: npx tsx scripts/rider-contact-test.ts
import { telUrl, whatsappAppUrl, whatsappWebUrl, whatsappMessage } from '../lib/rider-contact-core';
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, x: any = '') => { if (ok) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, JSON.stringify(x)); } };

const phone = '9876543210';
check('Call opens the dialler with +91 and the 10 digits, nothing more', telUrl(phone) === 'tel:+919876543210', telUrl(phone));
check('a number typed with spaces or +91 still gives the same link', telUrl('+91 98765 43210') === 'tel:+919876543210' && telUrl('09876543210') === 'tel:+919876543210');
for (const [greeting, label] of [['Namaste Sir', 'Sir'], ['Namaste Madam', 'Madam'], ['Namaste', 'plain']] as const) {
  const text = whatsappMessage(greeting);
  check(`the ${label} message starts with the right greeting and has the full text`, text.startsWith(greeting + ', I am your InstaDriver. I have accepted your ride request and am on my way to your pickup location. Please let me know if you need any assistance.'), text);
}
const text = whatsappMessage('Namaste Madam');
const app = whatsappAppUrl(phone, text), web = whatsappWebUrl(phone, text);
check('the WhatsApp app link targets 91 + the number', app.startsWith('whatsapp://send?phone=919876543210&text='), app);
check('the web fallback link targets 91 + the number', web.startsWith('https://wa.me/919876543210?text='), web);
check('the message is safely encoded (no raw spaces or commas in the link)', !/[ ,]/.test(app.split('text=')[1]) && !/[ ,]/.test(web.split('text=')[1]));
check('decoding the link gives back exactly the message', decodeURIComponent(app.split('text=')[1]) === text && decodeURIComponent(web.split('text=')[1]) === text);
const tricky = whatsappAppUrl(phone, 'Hi & bye? 100% #1 = "ok"');
check('characters that could break a link (& ? % # = quotes) are encoded', decodeURIComponent(tricky.split('text=')[1]) === 'Hi & bye? 100% #1 = "ok"' && tricky.split('text=')[1].indexOf('&') === -1, tricky);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
