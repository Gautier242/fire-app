// AQHI advice paraphrases Environment and Climate Change Canada's published
// health messages for the general population, in plain language.
export const STRINGS = {
  en: {
    title: 'Fire Near Me',
    check_button: 'Check fires near me',
    checking: 'Checking…',
    locate_failed: 'We could not find your location. Please choose your community.',
    choose_place: 'Choose your community',

    badge_safe: 'All clear',
    badge_caution: 'Take care',
    badge_danger: 'Danger',

    fire_heading: 'Wildfires',
    evac_heading: 'Evacuations',
    fire_none: 'No wildfires within {km} km of you.',
    fire_near: 'There is a wildfire {km} km {direction} of you.',
    fire_near_named: '{name} is burning {km} km {direction} of you.',
    fire_status: 'Status: {status}',
    fire_estimate_note: 'Fire areas outside British Columbia are estimated from satellite images and may be a few hours old.',

    evac_order: 'You are inside an evacuation ORDER area. Leave now and follow instructions from local officials.',
    evac_alert: 'You are inside an evacuation ALERT area. Be ready to leave quickly.',
    evac_none_found: 'No evacuation order or alert covers your location right now.',
    evac_cannot_check: 'We cannot check evacuation orders in {province}. Please check the official page.',
    evac_issued_by: 'Issued by {agency}',

    aqhi_heading: 'Air quality',
    aqhi_low: 'Good',
    aqhi_moderate: 'Moderate',
    aqhi_high: 'Unhealthy',
    aqhi_very_high: 'Very unhealthy',
    aqhi_low_advice: 'The air is fine. Enjoy your usual outdoor activities.',
    aqhi_moderate_advice: 'Most people can go outside as usual. If you have heart or breathing problems, take it easy.',
    aqhi_high_advice: 'Try to stay indoors and keep windows closed. Avoid hard work outside.',
    aqhi_very_high_advice: 'Stay indoors with windows closed. Avoid going outside if you can.',
    aqhi_unavailable: 'We do not have an air quality reading near you right now.',
    aqhi_distant: 'Nearest reading is from {name}, about {km} km away.',

    updated: 'Updated {minutes} minutes ago',
    stale_warning: 'This information is more than an hour old.',
    official_link: 'Official wildfire information for {province}',
    sources_link: 'Where this information comes from',
    map_link: 'See the map',

    dir_N: 'north', dir_NE: 'northeast', dir_E: 'east', dir_SE: 'southeast',
    dir_S: 'south', dir_SW: 'southwest', dir_W: 'west', dir_NW: 'northwest',
  },
  fr: {
    title: 'Feux près de moi',
    check_button: 'Vérifier les feux près de moi',
    checking: 'Vérification…',
    locate_failed: "Nous n'avons pas pu trouver votre position. Veuillez choisir votre municipalité.",
    choose_place: 'Choisissez votre municipalité',

    badge_safe: 'Rien à signaler',
    badge_caution: 'Prudence',
    badge_danger: 'Danger',

    fire_heading: 'Feux de forêt',
    evac_heading: 'Évacuations',
    fire_none: "Aucun feu de forêt à moins de {km} km de vous.",
    fire_near: 'Il y a un feu de forêt à {km} km au {direction} de vous.',
    fire_near_named: '{name} brûle à {km} km au {direction} de vous.',
    fire_status: 'État : {status}',
    fire_estimate_note: "Hors de la Colombie-Britannique, les zones de feu sont estimées par satellite et peuvent avoir quelques heures de retard.",

    evac_order: "Vous êtes dans une zone visée par un ORDRE d'évacuation. Partez maintenant et suivez les consignes des autorités locales.",
    evac_alert: "Vous êtes dans une zone visée par une ALERTE d'évacuation. Soyez prêt à partir rapidement.",
    evac_none_found: "Aucun ordre ni alerte d'évacuation ne vise votre position en ce moment.",
    evac_cannot_check: "Nous ne pouvons pas vérifier les ordres d'évacuation en {province}. Veuillez consulter la page officielle.",
    evac_issued_by: 'Émis par {agency}',

    aqhi_heading: "Qualité de l'air",
    aqhi_low: 'Bonne',
    aqhi_moderate: 'Modérée',
    aqhi_high: 'Mauvaise',
    aqhi_very_high: 'Très mauvaise',
    aqhi_low_advice: "L'air est bon. Profitez de vos activités habituelles à l'extérieur.",
    aqhi_moderate_advice: "La plupart des gens peuvent sortir normalement. Si vous avez des problèmes cardiaques ou respiratoires, allez-y doucement.",
    aqhi_high_advice: "Essayez de rester à l'intérieur et gardez les fenêtres fermées. Évitez les efforts à l'extérieur.",
    aqhi_very_high_advice: "Restez à l'intérieur, fenêtres fermées. Évitez de sortir si possible.",
    aqhi_unavailable: "Nous n'avons pas de mesure de la qualité de l'air près de vous en ce moment.",
    aqhi_distant: 'La mesure la plus proche vient de {name}, à environ {km} km.',

    updated: 'Mis à jour il y a {minutes} minutes',
    stale_warning: "Cette information date de plus d'une heure.",
    official_link: 'Information officielle sur les feux — {province}',
    sources_link: "D'où vient cette information",
    map_link: 'Voir la carte',

    dir_N: 'nord', dir_NE: 'nord-est', dir_E: 'est', dir_SE: 'sud-est',
    dir_S: 'sud', dir_SW: 'sud-ouest', dir_W: 'ouest', dir_NW: 'nord-ouest',
  },
};

export function t(lang, key, vars = {}) {
  const template = (STRINGS[lang] || STRINGS.en)[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match);
}
