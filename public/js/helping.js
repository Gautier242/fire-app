// public/js/helping.js
// What a person can actually do, given what they can do and what is happening.
//
// Static: no accounts, no backend, no moderation. Live neighbour-to-neighbour
// coordination needs all three and is deliberately elsewhere.
//
// The rule every entry obeys: never send an untrained person toward a fire.
// Every action is away from it, before it, or through an official channel. The
// most useful thing most people can do is not become a second casualty.

export const OFFICIAL_CHANNELS = {
  emergency: '112 / 18',
  volunteer: {
    fr: 'Réserve communale de sécurité civile — inscrivez-vous en mairie, hors période de crise',
    en: 'Réserve communale de sécurité civile — sign up at your mairie, outside a crisis',
  },
  firefighter: {
    fr: 'Sapeur-pompier volontaire — dossier auprès du SDIS de votre département',
    en: 'Volunteer firefighter — apply to your département SDIS',
  },
  prefecture: {
    fr: 'Consignes officielles : préfecture de votre département',
    en: 'Official instructions: your département préfecture',
  },
};

export const SKILLS = [
  { id: 'property_owner', label: { fr: 'Je suis propriétaire ou locataire', en: 'I own or rent property' } },
  { id: 'vehicle_4x4', label: { fr: "J'ai un véhicule tout-terrain", en: 'I have an off-road vehicle' } },
  { id: 'medical', label: { fr: 'Je suis soignant', en: 'I have medical training' } },
  { id: 'water_source', label: { fr: "J'ai une piscine ou une réserve d'eau", en: 'I have a pool or water tank' } },
  { id: 'local_knowledge', label: { fr: 'Je connais bien le terrain', en: 'I know the terrain well' } },
  { id: 'languages', label: { fr: 'Je parle plusieurs langues', en: 'I speak several languages' } },
  { id: 'shelter', label: { fr: 'Je peux héberger quelqu’un', en: 'I can host someone' } },
  { id: 'trained', label: { fr: 'Je suis pompier ou réserviste', en: 'I am a firefighter or reservist' } },
];

// Actions available to anyone, whatever they declared.
const UNIVERSAL = {
  ordered: [
    { do: { fr: 'Partez maintenant, par la route indiquée par les autorités.',
            en: 'Leave now, by the route the authorities give.' },
      why: { fr: "Un ordre d'évacuation n'attend pas votre avis sur le risque.",
             en: 'An evacuation order does not wait for your own risk assessment.' },
      channel: 'prefecture' },
    { do: { fr: 'Prévenez vos voisins, en particulier les personnes âgées ou isolées.',
            en: 'Warn your neighbours, especially anyone elderly or isolated.' },
      why: { fr: "FR-Alert n'atteint pas un téléphone éteint ni quelqu'un sans téléphone.",
             en: 'FR-Alert reaches neither a switched-off phone nor someone without one.' } },
  ],
  close: [
    { do: { fr: 'Ne téléphonez au 18 ou au 112 que pour signaler un fait nouveau.',
            en: 'Call 18 or 112 only to report something new.' },
      why: { fr: 'Les lignes de secours saturent, et une ligne saturée coûte des vies.',
             en: 'Emergency lines saturate, and a saturated line costs lives.' },
      channel: 'emergency' },
    { do: { fr: 'Fermez volets et fenêtres, rentrez le mobilier de jardin, gardez vos papiers sur vous.',
            en: 'Close shutters and windows, bring in garden furniture, keep your papers on you.' },
      why: { fr: "Les braises portent loin devant le front et allument ce qui traîne.",
             en: 'Embers travel far ahead of the front and light whatever is loose.' } },
  ],
  calm: [
    { do: { fr: 'Vérifiez votre itinéraire de sortie et une solution de repli.',
            en: 'Check your way out, and a second one.' },
      why: { fr: 'Une route peut être coupée par le feu ou par les secours.',
             en: 'A road can be cut by the fire or by the response.' } },
  ],
};

const BY_SKILL = {
  property_owner: {
    calm: [{ do: { fr: 'Débroussaillez autour de votre habitation — c’est une obligation légale en zone exposée.',
                   en: 'Clear vegetation around your home — a legal duty in exposed areas.' },
             why: { fr: 'Le débroussaillement décide si une maison survit sans que personne la défende.',
                    en: 'Clearance decides whether a house survives with nobody defending it.' },
             channel: 'prefecture' }],
  },
  water_source: {
    calm: [{ do: { fr: 'Signalez votre piscine ou réserve à votre mairie comme point d’eau utilisable.',
                   en: 'Register your pool or tank with your mairie as a usable water point.' },
             why: { fr: 'Les pompiers ne peuvent utiliser qu’un point d’eau qu’ils connaissent et peuvent atteindre.',
                    en: 'Firefighters can only use a water point they know about and can reach.' },
             channel: 'volunteer' }],
  },
  vehicle_4x4: {
    calm: [{ do: { fr: 'Proposez votre véhicule à la réserve communale, pas au front.',
                   en: 'Offer your vehicle to the réserve communale, not to the fireground.' },
             why: { fr: 'Un véhicule non coordonné bloque les accès dont les secours ont besoin.',
                    en: 'An uncoordinated vehicle blocks the access the response needs.' },
             channel: 'volunteer' }],
    close: [{ do: { fr: 'Proposez de conduire un voisin sans voiture vers un point sûr.',
                    en: 'Offer to drive a neighbour without a car to somewhere safe.' },
              why: { fr: "L'absence de véhicule est la première raison pour laquelle on n'évacue pas.",
                     en: 'Having no vehicle is the main reason people fail to evacuate.' } }],
  },
  medical: {
    close: [{ do: { fr: 'Signalez-vous à la mairie ou au centre d’accueil, pas sur le terrain.',
                    en: 'Report to the mairie or reception centre, not to the fireground.' },
              why: { fr: 'Les besoins sont aux points de rassemblement : fumée, stress, traitements oubliés.',
                     en: 'The need is at the assembly points: smoke, stress, forgotten medication.' },
              channel: 'prefecture' }],
  },
  local_knowledge: {
    close: [{ do: { fr: 'Transmettez ce que vous savez des accès et points d’eau à la mairie.',
                    en: 'Tell the mairie what you know about access and water points.' },
              why: { fr: 'Une équipe venue d’un autre département ne connaît pas vos pistes.',
                     en: 'A crew from another département does not know your tracks.' },
              channel: 'volunteer' }],
  },
  languages: {
    close: [{ do: { fr: 'Aidez à traduire les consignes officielles pour vos voisins et les touristes.',
                    en: 'Help translate official instructions for neighbours and visitors.' },
              why: { fr: 'FR-Alert diffuse en français, et une zone touristique en août ne l’est pas.',
                     en: 'FR-Alert broadcasts in French, and a tourist area in August is not.' } }],
  },
  shelter: {
    close: [{ do: { fr: 'Proposez votre hébergement via la mairie, pas sur les réseaux sociaux.',
                    en: 'Offer accommodation through the mairie, not on social media.' },
              why: { fr: 'Une offre coordonnée protège aussi la personne accueillie.',
                     en: 'A coordinated offer also protects the person being taken in.' },
              channel: 'prefecture' }],
  },
  trained: {
    close: [{ do: { fr: 'Passez par votre chaîne de commandement habituelle.',
                    en: 'Go through your normal chain of command.' },
              why: { fr: 'Un renfort spontané n’est pas assuré, pas tracé et pas attendu.',
                     en: 'A spontaneous volunteer is uninsured, untracked and unexpected.' },
              channel: 'firefighter' }],
  },
};

function phase(situation) {
  if (situation && situation.underOrder) return 'ordered';
  if (situation && situation.nearestFireKm !== null
      && situation.nearestFireKm !== undefined && situation.nearestFireKm <= 30) return 'close';
  return 'calm';
}

export function actionsFor(skillIds, situation, lang = 'fr') {
  const L = lang === 'en' ? 'en' : 'fr';
  const stage = phase(situation);
  // An action with no channel of its own still points somewhere: the préfecture
  // is where the instructions come from. No action is ever a dead end.
  const pick = (entry) => {
    const channel = OFFICIAL_CHANNELS[entry.channel || 'prefecture'];
    return {
      do: entry.do[L],
      why: entry.why[L],
      channel: typeof channel === 'string' ? channel : channel[L],
    };
  };

  // Under an order, leaving comes before anything a skill could contribute.
  const out = (UNIVERSAL[stage] || []).map(pick);
  if (stage === 'ordered') return out;

  for (const id of skillIds || []) {
    const table = BY_SKILL[id];
    if (!table) continue;  // an unknown id is ignored, never fatal
    for (const entry of table[stage] || []) out.push(pick(entry));
  }
  return out;
}
