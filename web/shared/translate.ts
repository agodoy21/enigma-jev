/**
 * German ⇄ American English on hover.
 *
 * Any element with `data-tr="<id>"` gets a tooltip from the glossary below.
 * `data-tr-de` / `data-tr-en` (inline) work too. The card shows the other
 * language first, then the one on screen, with a short note and, for machine
 * parts, a pronunciation.
 *
 * Behaviour follows macOS help tags: the first tag waits a moment, then
 * neighbouring tags appear at once while the pointer keeps moving; focus shows
 * them for keyboard users; Escape dismisses. A switch turns the layer off.
 */
import { esc } from './dom.js';
export interface Term {
  de: string;
  en: string;
  note?: string;
  say?: string;
  shown?: 'de' | 'en';
}

export const GLOSSARY: Record<string, Term> = {
  // Steps
  'step.open': {
    de: 'Entsperren',
    en: 'Unlock',
    note: 'A TypeSafe key opens the machine: Jev is the analyst that breaks the traffic.',
    shown: 'en',
  },
  'step.key': {
    de: 'Tagesschlüssel',
    en: 'Daily key',
    note: "The day's settings from the monthly key sheet, changed on every machine in the network at midnight. A break lasted until then.",
    shown: 'en',
  },
  'step.type': { de: 'Tippen', en: 'Type', shown: 'en' },
  'step.transmit': { de: 'Senden', en: 'Transmit', shown: 'en' },
  'step.break': {
    de: 'Knacken',
    en: 'Break',
    note: "Bletchley's word; the Germans believed it could not be done.",
    shown: 'en',
  },
  'step.decrypt': { de: 'Entschlüsseln', en: 'Decrypt', shown: 'en' },

  // Step 3 copy
  'type.kicker': { de: 'Schritt 3 · Tippen', en: 'Step 3 · Typing', shown: 'de' },
  'type.title': { de: 'Tippen Sie Ihre Nachricht', en: 'Type your message', shown: 'en' },
  'type.body': {
    de: 'Jeder Tastendruck schickt Strom durch das Steckerbrett, drei Walzen und die Umkehrwalze und zurück zu einer Lampe. Die rechte Walze dreht sich vor jedem Buchstaben weiter, so leuchtet dieselbe Taste selten zweimal dieselbe Lampe, und kein Buchstabe verschlüsselt sich je zu sich selbst.',
    en: 'Each press sends current through the plugboard, three rotors and the reflector, and back to a lamp. The right rotor steps before every letter, so the same key rarely lights the same lamp twice, and no letter ever lights itself.',
    shown: 'en',
  },
  'type.console': {
    de: 'Konsole',
    en: 'Console',
    note: 'Write the message here and let the machine type it, or type on the keys and it follows you.',
    shown: 'en',
  },
  'type.consoleHint': {
    de: 'hier schreiben und die Maschine tippen lassen',
    en: 'write it here and let the machine type it',
    shown: 'en',
  },
  'type.live': {
    de: 'Sie tippen auf der Maschine; die Konsole folgt Ihren Tasten',
    en: "You're typing on the machine; the console follows your keys",
    shown: 'en',
  },
  'type.openers': {
    de: 'Übliche Anfänge',
    en: 'Routine openers',
    note: 'Stock phrases messages began with: the cribs Bletchley guessed.',
    shown: 'en',
  },
  'type.openersHint': {
    de: 'womit Bletchley den Anfang einer Nachricht erriet',
    en: 'what Bletchley guessed messages began with',
    shown: 'en',
  },
  'type.auto': { de: 'Auf der Maschine tippen', en: 'Type it on the machine', shown: 'en' },
  'type.stop': { de: 'Anhalten', en: 'Stop', shown: 'en' },
  'type.speed': { de: 'Tempo', en: 'Speed', shown: 'en' },
  'type.clear': {
    de: 'Löschen und Walzen zurückstellen',
    en: 'Clear and reset the rotors',
    note: 'Back to the Grundstellung (start position).',
    shown: 'en',
  },
  'type.transmit': {
    de: 'Die Lampen senden',
    en: 'Transmit the lamps',
    note: 'Only the lit letters go on the air, never the key.',
    shown: 'en',
  },
  'type.hint': {
    de: 'Tippen Sie auf Ihrer Tastatur A–Z oder drücken Sie die Tasten der Maschine. Jeder Druck dreht die Walzen und lässt eine Lampe aufleuchten.',
    en: "Type on your keyboard A–Z or press the machine's keys. Every press steps the rotors and lights one lamp.",
    shown: 'en',
  },
  'type.chq': {
    de: 'CH → Q',
    en: 'CH becomes Q',
    note: 'Army operators wrote the common pair CH as the single letter Q.',
    shown: 'de',
  },
  'svc.Heer': { de: 'Heer', en: 'Army', note: 'German Army traffic, broken in Hut 6.', say: 'hair', shown: 'de' },
  'svc.Luftwaffe': {
    de: 'Luftwaffe',
    en: 'Air Force',
    note: "Air Force traffic: Bletchley's easiest and most prolific source.",
    say: 'LOOFT-vah-feh',
    shown: 'de',
  },
  'svc.Kriegsmarine': {
    de: 'Kriegsmarine',
    en: 'Navy',
    note: 'Naval traffic: three rotors from eight, broken in Hut 8.',
    say: 'KREEKS-mah-ree-neh',
    shown: 'de',
  },
  'tape.keys': { de: 'Tasten', en: 'Keys', note: 'The letters you pressed.', shown: 'en' },
  'tape.lamps': { de: 'Lampen', en: 'Lamps', note: 'The letters that lit: the ciphertext.', shown: 'en' },
  'tape.cipherIn': { de: 'Geheimtext', en: 'Cipher in', shown: 'en' },
  'tape.plainOut': { de: 'Klartext', en: 'Plain out', shown: 'en' },

  // Machine parts
  'm.window': {
    de: 'Walzenfenster',
    en: 'Rotor window',
    note: "Shows the rotor's current letter. Click or scroll to turn it while setting the key.",
    say: 'VAL-tsen-fen-ster',
    shown: 'de',
  },
  'm.wheel': {
    de: 'Einstellrad',
    en: 'Thumbwheel',
    note: 'The ribbed edge the operator turns by hand. Behind it three pawls push on every key press; only the right rotor always moves, the others when a notch lets their pawl drop in.',
    say: 'INE-shtell-raht',
    shown: 'de',
  },
  'm.rotor': {
    de: 'Walze',
    en: 'Rotor',
    note: 'One of five wired wheels, I to V; three sit in the machine. The military rewired them in secret, so a commercial Enigma was no help to anyone.',
    say: 'VAL-tseh',
    shown: 'de',
  },
  'm.ukw': {
    de: 'Umkehrwalze B',
    en: 'Reflector B',
    note: 'Sends the current back through the rotors, which is why no letter can encipher to itself.',
    say: 'OOM-kair-val-tseh',
    shown: 'de',
  },
  'm.lamp': {
    de: 'Lampe',
    en: 'Lamp',
    note: 'Lights the enciphered letter, and never the key being pressed. That one flaw let Bletchley slide a guessed phrase along a message to place it.',
    say: 'LAHM-peh',
    shown: 'de',
  },
  'm.key': {
    de: 'Taste',
    en: 'Key',
    note: 'Press to encipher one letter; the rotors step first, so pressing it again lights a different lamp.',
    say: 'TAHS-teh',
    shown: 'de',
  },
  'm.socket': {
    de: 'Steckerbuchse',
    en: 'Plugboard socket',
    note: 'A cable between two sockets swaps those letters on the way in and out.',
    say: 'SHTEK-er-boox-eh',
    shown: 'de',
  },
  'm.plugboard': {
    de: 'Steckerbrett',
    en: 'Plugboard',
    note: 'Ten cables from 1939: 150 trillion wirings, most of the key space. A Bombe never tried them one by one; it guessed one cable and let the contradictions rule out the rest.',
    say: 'SHTEK-er-brett',
    shown: 'de',
  },
  'm.lid': { de: 'Deckel', en: 'Lid', say: 'DECK-el', shown: 'de' },
  'm.flap': {
    de: 'Frontklappe',
    en: 'Front flap',
    note: 'Covers the plugboard. Opened to set the cables for the day, and kept shut while operating, as the manual required.',
    say: 'FRONT-klap-peh',
    shown: 'de',
  },
  'm.note': { de: 'Chiffriermaschine', en: 'Cipher machine', say: 'shif-REER-mah-shee-neh', shown: 'de' },

  // Operator habits (step 2)
  'habit.cilly': {
    de: 'Nachlässiger Spruchschlüssel',
    en: 'Cilly',
    note: "Bletchley's word for a lazy setting: a girlfriend's name, a keyboard run, BER then LIN. Guess it and you hold a three-letter crib.",
    shown: 'en',
  },
  'habit.herivel': {
    de: 'Herivel-Tipp',
    en: 'Herivel tip',
    note: "John Herivel's 1940 insight: operators set the rings, then barely moved the rotors. The morning's first settings clustered around the rings.",
    shown: 'en',
  },
  'sheet.order': {
    de: 'Walzenlage',
    en: 'Rotor order',
    note: 'Three of five rotors in a chosen order: 60 ways from December 1938, ten times the 6 of the commercial machine.',
    say: 'VAL-tsen-lah-geh',
    shown: 'de',
  },
  'sheet.grund': {
    de: 'Grundstellung',
    en: 'Start position',
    note: 'The letters in the windows before typing. From 1940 the operator picked one, sent it in clear, and enciphered a fresh message key from it; lazy picks were cillies.',
    say: 'GROONT-shtell-oong',
    shown: 'de',
  },
  'habit.csko': {
    de: 'Nachbarstecker',
    en: 'Consecutive plugs',
    note: 'Luftwaffe key sheets never joined A to B, B to C and so on. The Bombe had a switch that discarded any stop implying such a plug.',
    shown: 'en',
  },
  'm.ring': {
    de: 'Ringstellung',
    en: 'Ring setting',
    note: 'Undo a clip and the lettered ring turns against the wiring: the same wire now joins different letters.',
    say: 'RING-shtell-oong',
    shown: 'de',
  },

  // Openers (the cribs), German as written out, American English meaning
  'crib.KEINEBESONDERENEREIGNISSE': {
    de: 'Keine besonderen Ereignisse',
    en: 'Nothing to report',
    note: 'A routine daily message, and a gift of a crib.',
    shown: 'de',
  },
  'crib.OBERKOMMANDODERWEHRMACHT': { de: 'Oberkommando der Wehrmacht', en: 'Armed Forces High Command', shown: 'de' },
  'crib.WETTERVORHERSAGE': {
    de: 'Wettervorhersage',
    en: 'Weather forecast',
    note: 'Weather ships reported at the same hour every day, so Bletchley could guess the words: WETTERVORHERSAGEBISKAYA, weather forecast Biscay.',
    shown: 'de',
  },
  'crib.WETTERMELDUNG': { de: 'Wettermeldung', en: 'Weather report', shown: 'de' },
  'crib.WETTERBERICHT': { de: 'Wetterbericht', en: 'Weather report', shown: 'de' },
  'crib.FUNKSPRUCH': { de: 'Funkspruch', en: 'Radio message', shown: 'de' },
  'crib.SPRUCHNUMMER': { de: 'Spruchnummer', en: 'Message number', shown: 'de' },
  'crib.FUEHRERHAUPTQUARTIER': {
    de: 'Führerhauptquartier',
    en: "Hitler's headquarters",
    note: 'Umlauts were spelled out: Ü became UE.',
    shown: 'de',
  },
  'crib.BEFEHL': { de: 'Befehl', en: 'Order', shown: 'de' },
  'crib.FEINDLIQE': {
    de: 'feindliche',
    en: 'enemy …',
    note: 'The army wrote CH as Q: FEINDLICHE became FEINDLIQE.',
    shown: 'de',
  },
  'crib.AUFKLAERUNG': { de: 'Aufklärung', en: 'Reconnaissance', shown: 'de' },
  'crib.AUFKLX': { de: 'Aufkl.', en: 'Recon (abbreviation)', note: 'X stood for the full stop.', shown: 'de' },
  'crib.TAGESMELDUNG': { de: 'Tagesmeldung', en: 'Daily report', shown: 'de' },
  'crib.LAGEBERICHT': { de: 'Lagebericht', en: 'Situation report', shown: 'de' },
  'crib.ARMEEOBERKOMMANDO': { de: 'Armeeoberkommando', en: 'Army headquarters', shown: 'de' },
  'crib.GENERALKOMMANDO': { de: 'Generalkommando', en: 'Corps headquarters', shown: 'de' },
  'crib.HEERESGRUPPE': { de: 'Heeresgruppe', en: 'Army group', shown: 'de' },
  'crib.LUFTFLOTTE': { de: 'Luftflotte', en: 'Air fleet', shown: 'de' },
  'crib.FLIEGERKORPS': { de: 'Fliegerkorps', en: 'Air corps', shown: 'de' },
  'crib.VONVON': {
    de: 'von … von',
    en: 'from … from',
    note: 'Naval messages opened with the sender, repeated.',
    shown: 'de',
  },
  'crib.ANBEFEHLSHABERDERUBOOTE': { de: 'An Befehlshaber der U-Boote', en: 'To U-boat command', shown: 'de' },
  'crib.BEFEHLSHABERDERUBOOTE': { de: 'Befehlshaber der U-Boote', en: 'U-boat command', shown: 'de' },
  'crib.GELEITZUG': { de: 'Geleitzug', en: 'Convoy', shown: 'de' },
  'crib.STANDORT': { de: 'Standort', en: 'Position', shown: 'de' },
  'crib.KRKR': { de: 'Kr Kr', en: 'Urgent', note: 'The naval priority prefix, doubled.', shown: 'de' },

  // The default message
  'msg.default': {
    de: 'Wettervorhersage für morgen. Nebel über dem Flugplatz, Sicht unter fünfhundert Meter. Aufklärer bleiben am Boden bis Mittag.',
    en: 'Weather forecast for tomorrow. Fog over the airfield, visibility under five hundred meters. Reconnaissance planes stay grounded until noon.',
    shown: 'de',
  },
};

const LS = 'enigma-jev.translate';
let enabled = (() => {
  try {
    return localStorage.getItem(LS) !== 'off';
  } catch {
    return true;
  }
})();
export const translationsOn = () => enabled;
export function setTranslations(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(LS, on ? 'on' : 'off');
  } catch {
    /* per-viewer convenience only */
  }
  if (!on) hide();
  for (const b of document.querySelectorAll<HTMLElement>('.trtoggle')) b.setAttribute('aria-pressed', String(on));
}

const tip = document.createElement('div');
tip.className = 'tr-tip';
tip.setAttribute('role', 'tooltip');
tip.id = 'tr-tip';
document.body.append(tip);

let current: HTMLElement | null = null,
  showTimer = 0,
  hideTimer = 0,
  lastHidden = 0,
  quietUntil = 0;

/** While someone is typing on the machine, tags stay out of the way. */
export function quiet(ms = 1500) {
  quietUntil = performance.now() + ms;
  hide();
}

function termFor(el: HTMLElement): Term | null {
  const id = el.dataset.tr;
  if (id && GLOSSARY[id]) return GLOSSARY[id];
  if (el.dataset.trDe && el.dataset.trEn)
    return {
      de: el.dataset.trDe,
      en: el.dataset.trEn,
      note: el.dataset.trNote,
      shown: (el.dataset.trShown as 'de' | 'en') ?? 'en',
    };
  return null;
}

function render(t: Term) {
  const first: 'de' | 'en' = t.shown === 'de' ? 'en' : 'de';
  const line = (lang: 'de' | 'en', main: boolean) =>
    `<div class="tr-line ${main ? 'main' : 'sub'}"><span class="tr-lang">${lang === 'de' ? 'DE' : 'US'}</span><span class="tr-text" lang="${lang === 'de' ? 'de' : 'en-US'}">${esc(t[lang])}</span></div>`;
  tip.innerHTML =
    line(first, true) +
    line(t.shown ?? 'en', false) +
    (t.say ? `<div class="tr-say">say <b>${esc(t.say)}</b></div>` : '') +
    (t.note ? `<div class="tr-note">${esc(t.note)}</div>` : '');
  tip.classList.toggle('long', t.de.length > 60 || t.en.length > 60);
}

function place(el: HTMLElement) {
  const r = el.getBoundingClientRect(),
    w = tip.offsetWidth,
    h = tip.offsetHeight,
    gap = 10;
  const above = r.top - h - gap > 8;
  const left = Math.min(window.innerWidth - w - 10, Math.max(10, r.left + r.width / 2 - w / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${above ? r.top - h - gap : r.bottom + gap}px`;
  tip.dataset.side = above ? 'top' : 'bottom';
  tip.style.setProperty('--arrow', `${Math.min(w - 16, Math.max(16, r.left + r.width / 2 - left))}px`);
}

function show(el: HTMLElement, instant: boolean) {
  const t = termFor(el);
  if (!t || !enabled || performance.now() < quietUntil) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const go = () => {
    current = el;
    render(t);
    tip.classList.add('on');
    place(el);
    el.setAttribute('aria-describedby', 'tr-tip');
  };
  if (instant) go();
  else showTimer = window.setTimeout(go, 420);
}
function hide() {
  clearTimeout(showTimer);
  if (current) current.removeAttribute('aria-describedby');
  if (tip.classList.contains('on')) lastHidden = performance.now();
  tip.classList.remove('on');
  current = null;
}

const target = (e: Event) =>
  e.target instanceof Element ? (e.target.closest('[data-tr], [data-tr-de]') as HTMLElement | null) : null;
const onOver = (e: Event) => {
  const el = target(e);
  if (!el) return;
  if (el === current) return;
  // Moving between tags keeps the layer "warm": no second delay.
  show(el, tip.classList.contains('on') || performance.now() - lastHidden < 600);
};
const onOut = (e: Event) => {
  const el = target(e);
  if (!el) return;
  const to = (e as MouseEvent).relatedTarget as Element | null;
  if (to && el.contains(to)) return;
  clearTimeout(showTimer);
  hideTimer = window.setTimeout(hide, 80);
};
// Pointer events for real pointers; mouse events too, for synthetic and older input paths.
document.addEventListener('pointerover', onOver);
document.addEventListener('mouseover', onOver);
document.addEventListener('pointerout', onOut);
document.addEventListener('mouseout', onOut);
document.addEventListener('focusin', e => {
  const el = target(e);
  if (el) show(el, true);
});
document.addEventListener('focusout', hide);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hide();
});
document.addEventListener(
  'scroll',
  () => {
    if (current) place(current);
  },
  { passive: true, capture: true },
);
document.addEventListener('pointerdown', e => {
  if (target(e)?.closest('.em-scene')) quiet();
  else clearTimeout(showTimer);
});
