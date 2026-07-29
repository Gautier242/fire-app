// The French audit page. Every timestamp, every count and every coverage claim
// is read out of the published data files, so this page cannot drift away from
// what the map is actually serving. Nothing about freshness is written here.
//
// Copy lives in COPY below, the same pattern as app-fr.js, and deliberately not
// in i18n.js: that table is the Canadian one and tests-js/test_i18n.js asserts
// its two key sets are exactly equal, so French-only keys would break it.
const LANG_KEY = 'fire-near-me.fr.lang';
const $ = (id) => document.getElementById(id);

// What each source is, keyed by the id in summary.json. `limits` are taken from
// the build module's own docstring rather than invented here. An id we do not
// recognise still renders, with an honest "we cannot describe this".
const SOURCES = {
  mdf: {
    publisher: { fr: 'Météo-France — Météo des forêts', en: 'Météo-France — Météo des forêts' },
    host: 'meteofrance.s3.sbg.io.cloud.ovh.net',
    home: 'https://meteofrance.com/meteo-des-forets',
    what: {
      fr: "Le niveau de danger de feu de forêt officiel, de 1 à 4, pour aujourd'hui et pour demain. Météo-France en publie un par département, une fois par jour vers 14 h 50 UTC — 16 h 50 heure de Paris en été. C'est la seule information officielle et nationale de cette carte.",
      en: 'The official forest-fire danger level, 1 to 4, for today and tomorrow. Météo-France publishes one per département, once a day around 14:50 UTC. It is the only official nationwide information on this map.',
    },
    limits: {
      fr: ["Un seul niveau pour tout un département : il ne dit rien de votre rue.",
        "France métropolitaine seulement.",
        "Publié une fois par jour. Un vent qui se lève l'après-midi n'y est pas."],
      en: ['One level for a whole département: it says nothing about your street.',
        'Metropolitan France only.',
        'Published once a day. An afternoon wind change is not in it.'],
    },
    count: (s) => ({ fr: `${num((s.danger || []).length)} départements`, en: `${num((s.danger || []).length)} départements` }),
  },
  atmo: {
    publisher: { fr: "Atmo France — indice ATMO de qualité de l'air", en: 'Atmo France — ATMO air quality index' },
    host: 'data.atmo-france.org',
    home: 'https://www.atmo-france.org/',
    what: {
      fr: "La qualité de l'air, commune par commune. Nous gardons deux chiffres : l'indice ATMO global, et séparément l'indice des particules fines PM2,5 — c'est celui-là que la fumée d'un feu fait monter. L'indice global est le pire de ses sous-indices, et un jour de chaleur c'est presque toujours l'ozone : n'afficher que lui cacherait la fumée derrière l'ozone exactement les jours où elle compte.",
      en: 'Air quality, commune by commune. We keep two numbers: the overall ATMO index, and separately the PM2.5 fine-particle index — that is the one wildfire smoke moves. The overall index is the worst of its sub-indices, and on a hot day that is almost always ozone: showing only it would hide smoke behind ozone on exactly the days it matters.',
    },
    limits: {
      fr: ["C'est un calcul, pas une mesure : la carte est modélisée à partir de quelques centaines de stations.",
        "Une valeur par jour, pas par heure.",
        "Nous gardons la commune la plus touchée par carré d'environ 20 km, sinon le fichier dépasse à lui seul tout le budget de la page."],
      en: ['It is a model, not a measurement: the surface is interpolated from a few hundred stations.',
        'One value per day, not per hour.',
        'We keep the worst commune per roughly 20 km cell — otherwise this one file blows the whole page budget.'],
    },
    count: (s) => ({ fr: `${num((s.air_quality || []).length)} communes`, en: `${num((s.air_quality || []).length)} communes` }),
  },
  firms: {
    publisher: { fr: 'NASA FIRMS — détections satellites VIIRS', en: 'NASA FIRMS — VIIRS satellite detections' },
    host: 'firms.modaps.eosdis.nasa.gov',
    home: 'https://firms.modaps.eosdis.nasa.gov/',
    what: {
      fr: "Les points chauds vus par satellite sur les dernières 24 heures. Nous lisons les deux satellites (NOAA-20 et Suomi-NPP) parce qu'ils ne passent pas aux mêmes heures : le 29 juillet 2026, l'un seul voyait 179 foyers, l'autre 189, et ensemble 294. Un pixel fait 375 m et un même feu en allume plusieurs, donc les détections à moins de 1,5 km l'une de l'autre sont regroupées en un seul foyer.",
      en: 'Satellite heat detections over the last 24 hours. We read both satellites (NOAA-20 and Suomi-NPP) because they fly different overpass times: on 2026-07-29 one alone saw 179 incidents, the other 189, and merged 294. A pixel is 375 m and one fire lights several, so detections within 1.5 km of each other are grouped into one incident.',
    },
    limits: {
      fr: ["Ce sont des détections de chaleur, pas des feux de forêt : voir la section plus bas.",
        "Quelques passages par jour seulement, et un nuage suffit à masquer un feu.",
        "Le rectangle interrogé dépasse les frontières : les foyers hors de France sont dessinés en pâle."],
      en: ['These are heat detections, not wildfires: see the section below.',
        'Only a few passes a day, and cloud blocks the sensor outright.',
        'The query rectangle crosses the borders: detections outside France are drawn faded.'],
    },
    count: (s) => {
      const fires = s.fires || [];
      const foreign = fires.filter((f) => f.in_country === false).length;
      const industrial = fires.filter((f) => f.industrial).length;
      return {
        fr: `${num(fires.length)} foyers, dont ${num(foreign)} hors de France et ${num(industrial)} marqués industriels`,
        en: `${num(fires.length)} incidents, of which ${num(foreign)} outside France and ${num(industrial)} marked industrial`,
      };
    },
  },
  bison_fute: {
    publisher: { fr: 'Bison Futé / CNIR — coupures de routes', en: 'Bison Futé / CNIR — road closures' },
    host: 'tipi.bison-fute.gouv.fr',
    home: 'https://www.bison-fute.gouv.fr/',
    what: {
      fr: "Les routes coupées sur le réseau routier national. La deuxième question après « faut-il partir » est « par où passer », et c'est le seul fichier national qui y répond. Nous ne prenons que les coupures : les chantiers du même serveur sont volontairement ignorés, parce qu'une carte couverte d'équipes de goudronnage pendant une évacuation est pire qu'aucune carte des routes.",
      en: 'Roads closed on the réseau routier national. The second question after "should I leave" is "which way can I drive", and this is the only national feed that answers it. We take only the closures: the roadworks table on the same server is deliberately ignored, because a map covered in paving crews during an evacuation is worse than no road layer.',
    },
    limits: {
      fr: ["Réseau national seulement : une route communale coupée par le préfet n'y figure jamais.",
        "La source ne donne aucune coordonnée. Chaque coupure est posée au centre de sa commune, donc le point peut être à plusieurs kilomètres du barrage réel.",
        "Les codes d'événement de la source sont publiés sans légende, donc nous ne les traduisons pas."],
      en: ['National network only: a communal road closed by a préfet never appears.',
        'The feed carries no coordinates. Each closure is placed at its commune centre, so a pin can sit several kilometres from the actual cut.',
        'The feed’s event codes are published with no legend anywhere, so we do not decode them.'],
    },
    count: (s) => ({ fr: `${num((s.closures || []).length)} coupures`, en: `${num((s.closures || []).length)} closures` }),
  },
  opensky: {
    publisher: { fr: 'OpenSky Network — aéronefs', en: 'OpenSky Network — aircraft' },
    host: 'opensky-network.org',
    home: 'https://opensky-network.org/',
    what: {
      fr: "Les avions et hélicoptères qui volent bas près d'un feu détecté. Le transpondeur dit où se trouve un appareil, jamais ce qu'il fait : rien ici ne décide qu'un avion combat un feu, et la carte n'affirme que ce que la donnée permet.",
      en: 'Aircraft flying low near a detected fire. A transponder says where an aircraft is, never what it is doing: nothing here decides that an aircraft is fighting a fire, and the map claims only what the data supports.',
    },
    limits: {
      fr: ["Le rôle d'un appareil n'est jamais confirmé.",
        "Relevé toutes les 5 minutes : le quota gratuit de la source ne permet pas mieux, et personne ne devrait évacuer sur la position d'un avion.",
        "Un appareil sans transpondeur, ou hors de portée des récepteurs bénévoles, est invisible."],
      en: ['What an aircraft is doing is never confirmed.',
        'Read every 5 minutes: the free quota allows no more, and nobody should evacuate on an aircraft’s position.',
        'An aircraft with no transponder, or out of range of the volunteer receivers, is invisible.'],
    },
    count: (s) => ({ fr: `${num((s.aircraft || []).length)} aéronefs près d'un feu`, en: `${num((s.aircraft || []).length)} aircraft near a fire` }),
  },
};

const COPY = {
  fr: {
    lang: 'English', back: 'Voir la carte',
    title: "D'où viennent ces informations",
    intro: "Cette page dit exactement ce que cette carte sait, d'où cela vient, quand nous l'avons vérifié — et surtout ce qu'elle ne peut pas voir. Un outil de sécurité que personne ne peut vérifier est un outil auquel personne ne devrait se fier.",

    h_sources: 'Ce que contient chaque source',
    sources_intro: "Nous vérifions chacune de ces sources toutes les 30 minutes. Si une vérification échoue, nous gardons la dernière bonne copie et nous le disons, plutôt que de ne rien afficher. Les heures ci-dessous sont lues dans le fichier de données lui-même.",
    lbl_publisher: 'Publié par', lbl_checked: 'Dernière vérification', lbl_state: 'En ce moment',
    lbl_content: 'Dans le fichier', lbl_host: "Point d'accès", lbl_page: 'Page de la source',
    lbl_limits: 'Limites', lbl_updated: 'Mis à jour à la main le', lbl_kept: 'Tenu par',
    state_ok: 'À jour', state_stale: 'Ancien', state_failed: 'Échec de la vérification',
    never: 'Jamais récupéré',
    failed_note: "Notre dernière vérification de cette source a échoué. Cette couche est vide sur la carte, et une couche vide ne veut jamais dire qu'il n'y a rien.",
    stale_note: "Notre dernière vérification de cette source a échoué. Ce que vous voyez est la copie de l'heure indiquée ci-dessus, et elle vieillit.",
    old_note: "Ce fichier a plus d'une heure. La source n'est pas en cause : c'est notre reconstruction qui n'a pas tourné. Tant que l'heure ci-dessus ne bouge pas, rien de ce qui s'est passé depuis n'est sur la carte.",
    unknown: "Cette source est dans le fichier de données mais cette page n'en a pas de description. Considérez-la comme non vérifiée.",
    minutes: (m) => `il y a ${m} min`,

    src_evac: "Liste d'évacuations tenue à la main",
    src_evac_what: "Il n'existe aucun fichier public national des évacuations. Cette liste est écrite à la main : quelqu'un lit les annonces des préfectures et note les communes concernées. Elle indique aussi quels départements sont réellement surveillés, parce qu'une liste vide sans cette information ressemble à une bonne nouvelle.",
    src_water: "Points d'eau incendie",
    src_water_what: "Les points où les pompiers et les Canadairs se ravitaillent : bornes, citernes, retenues. C'est la seule couche destinée aux pompiers plutôt qu'aux habitants, et la plus morcelée de l'application.",
    src_water_where: "Chaque registre vient du SDIS ou de la collectivité qui le publie, via data.gouv.fr. Ce fichier est reconstruit avec les autres, mais il ne bouge que quand un SDIS met son registre à jour — c'est-à-dire rarement.",

    h_cannot: 'Ce que cette carte ne peut pas faire',
    cannot_intro: "C'est la section la plus importante de cette page. Ce que cette carte ignore compte autant que ce qu'elle montre, et rien ici n'est adouci.",

    evac_h: "Elle ne voit aucun ordre d'évacuation",
    evac_p: "En France, les ordres d'évacuation partent par FR-Alert : un message envoyé directement sur les téléphones présents dans la zone concernée. Il n'y a pas de fichier public à lire — chaque préfecture publie ses arrêtés sur son propre site, en PDF, et il y en a 101. Cette carte ne peut donc pas les voir. Elle ne peut afficher que la liste tenue à la main.",
    evac_watched: (deps) => `Départements réellement surveillés en ce moment : ${deps}.`,
    evac_none_short: 'Aucun département surveillé',
    evac_none: "Aucun département n'est surveillé en ce moment. Aujourd'hui, cette carte ne prétend donc rien du tout, nulle part, au sujet des évacuations. Si aucune zone n'apparaît près de chez vous, cela ne signifie pas qu'il n'y a pas d'ordre d'évacuation : cela signifie que nous ne regardons pas.",
    evac_unwatched: "Un département absent de cette liste est traité exactement comme s'il n'existait aucun fichier : nous n'en disons rien, ni dans un sens ni dans l'autre.",
    evac_orders: (n) => `${n} zone(s) d'évacuation dans le fichier en ce moment.`,

    sdis_h: 'Elle ne montre pas les pompiers sur le terrain',
    sdis_p: "Les SDIS ne publient pas la position de leurs engins en temps réel, et aucun agrégateur ne le fait à leur place. Vérifié le 29 juillet 2026 : les 22 jeux de données SDIS ouverts sur data.gouv.fr sont des budgets et des découpages administratifs, pas des positions. Même les casernes sont mal connues — OpenStreetMap n'en recense que 4 dans toute la Gironde, alors que le nombre réel est proche de 100. Une carte vide veut dire que nous ne les voyons pas. Elle ne veut jamais dire qu'il n'y a personne.",

    lag_h: 'Elle a du retard sur le feu',
    lag_p: "Les satellites ne surveillent pas en continu : ils passent quelques fois par jour (mesuré le 29 juillet 2026 : cinq passages sur la France en 24 heures, les deux satellites confondus). Entre deux passages, personne ne regarde. Et un nuage bloque purement et simplement le capteur. Un feu qui a démarré il y a une heure peut être totalement absent de cette carte. L'absence de détection n'est jamais une garantie de sécurité.",

    roads_h: 'Elle ne voit pas toutes les routes coupées',
    roads_p: "La source ne couvre que le réseau routier national : autoroutes, routes nationales, et quelques départementales gérées par une DIR. Un préfet qui ferme une route communale à côté d'un feu n'apparaîtra jamais ici, et rien que le CNIR n'a pas encore enregistré n'y figure non plus. En plus, comme la source ne donne pas de coordonnées, chaque coupure est posée au centre de sa commune : le point peut être à plusieurs kilomètres du barrage réel.",

    water_h: "Elle ne connaît qu'une petite partie des points d'eau",
    water_p: "La défense extérieure contre l'incendie est une compétence des communes, encadrée par un règlement départemental : chaque SDIS tient son propre registre, il n'y a aucune autorité nationale et donc aucun fichier national. Nous n'utilisons que les registres réellement publiés et lisibles.",
    water_share: (points) => `Cela fait ${points} points d'eau, soit environ 7 % des quelque 800 000 points estimés en France. Un pompier qui ne voit pas de point d'eau ne doit surtout pas en conclure qu'il n'y en a pas.`,
    water_capacity: "La capacité est presque toujours inconnue : la plupart des registres publient un débit en m³/h, pas un volume stocké. Un débit n'est jamais converti en volume, et un volume inconnu — ou publié à zéro — reste affiché comme inconnu. Envoyer une équipe vers une citerne que la carte disait pleine est l'erreur qui compte ici.",
    water_btn: "Afficher les zones réellement couvertes",
    water_btn_loading: 'Chargement du registre…',
    water_note: "Le fichier des points d'eau est gros ; il n'est chargé que si vous le demandez.",
    water_head: (n, points) => `${n} zones couvertes, ${points} points`,
    water_failed: (msg) => `Impossible de charger le registre des points d'eau : ${msg}`,
    scope_dep: 'Département entier', scope_local: 'Secteur local',
    points_n: (n) => `${n} points`,

    h_dots: 'Pourquoi certains points ne sont pas des feux',
    heat_p: "FIRMS détecte de la chaleur, pas des feux de forêt. Une raffinerie, une aciérie ou une torchère brûle au même endroit tous les jours et ressemble exactement à un feu vu du satellite. La Mède et Lacq apparaissent chaque jour ; les torchères de Fos-sur-Mer expliquent la plus grande partie des détections des Bouches-du-Rhône. Le problème n'est pas cosmétique : une fois qu'un lecteur a appris à ignorer deux points fixes, il ignore aussi le vrai feu à côté.",
    mask_p: (window, days, marked) => `Nous ne marquons pas ces points à la main. Un point est appelé industriel quand il brûle au même endroit la plupart des jours d'une fenêtre de ${window} jours. Nous avons ${days} jour(s) d'observation pour l'instant, et ${marked} point(s) sont marqués comme industriels. Une torchère nouvelle apparaîtra donc comme un feu jusqu'à ce que nous ayons assez de jours pour la reconnaître. Le biais est volontaire : en cas de doute, nous ne masquons pas, parce que montrer une raffinerie est une erreur moins grave que cacher un feu.`,
    foreign_p: (n, total) => `Les feux hors de France sont dessinés en pâle. La requête satellite utilise un rectangle, pas une frontière : il déborde sur l'Espagne, la Belgique, la Suisse et l'Italie du Nord. C'est voulu — un feu à 5 km de la frontière compte toujours dans les Pyrénées-Orientales — mais il faut le dire, car avant que ce soit corrigé, León en Espagne remontait comme le plus gros feu « français » de la carte. En ce moment, ${n} des ${total} foyers affichés sont hors de France.`,

    h_not: "Ce que ce site n'est pas",
    not_official_h: "Ce n'est pas une source officielle",
    not_official_p: "Personne dans une préfecture, un SDIS ou un centre opérationnel ne surveille ce site. Il republie des données publiques. Quand ce site et la source officielle se contredisent, c'est la source officielle qui a raison.",
    no_alerts_h: "Il n'envoie aucune alerte",
    no_alerts_p: "Aucune notification, aucun SMS, aucune sirène. Rien ne vous joindra si vous ne regardez pas la page. En France, l'alerte de la population passe par FR-Alert, directement sur votre téléphone, et par les consignes de votre préfecture. Gardez votre téléphone allumé et le son activé.",
    stale_h: 'Il peut être dépassé',
    stale_p: "Nous vérifions toutes les 30 minutes, et les sources que nous lisons ont elles-mêmes du retard sur le terrain : le bulletin de danger sort une fois par jour, les satellites passent quelques fois par jour. Les heures affichées sur cette page sont celles de notre dernière récupération, pas celles du déplacement du feu.",
    emergency_p: "En cas de danger immédiat, appelez le 18 ou le 112, et suivez les consignes des autorités locales. Pour savoir ce qui est décidé chez vous : le site de votre préfecture, et FR-Alert.",
    alert_link: 'FR-Alert', prefecture_link: 'Ministère de l’Intérieur — préfectures',
    generated: (stamp) => `Fichier de données produit le ${stamp}`,
    failed_page: (msg) => `Données indisponibles : ${msg}`,
  },
  en: {
    lang: 'Français', back: 'See the map',
    title: 'Where this information comes from',
    intro: 'This page says exactly what this map knows, where it comes from, when we last checked it — and above all what it cannot see. A safety tool nobody can audit is one nobody should trust.',

    h_sources: 'What each source contains',
    sources_intro: 'We check each of these sources every 30 minutes. If a check fails we keep the last good copy and say so, rather than showing nothing. The times below are read from the data file itself.',
    lbl_publisher: 'Published by', lbl_checked: 'Last checked', lbl_state: 'Right now',
    lbl_content: 'In the file', lbl_host: 'Endpoint', lbl_page: 'Source page',
    lbl_limits: 'Limits', lbl_updated: 'Updated by hand on', lbl_kept: 'Kept by',
    state_ok: 'Up to date', state_stale: 'Old', state_failed: 'Check failed',
    never: 'Never fetched',
    failed_note: 'Our last check of this source failed. This layer is empty on the map, and an empty layer never means there is nothing there.',
    stale_note: 'Our last check of this source failed. What you see is the copy from the time above, and it is getting older.',
    old_note: 'This file is more than an hour old. The source is not at fault: our own rebuild has not run. Until the time above moves, nothing that happened since is on the map.',
    unknown: 'This source is in the data file but this page has no description for it. Treat it as unverified.',
    minutes: (m) => `${m} min ago`,

    src_evac: 'Hand-kept evacuation list',
    src_evac_what: 'There is no national public evacuation feed. This list is written by hand: someone reads the prefecture announcements and records the communes concerned. It also states which départements anybody is actually watching, because an empty list without that reads like good news.',
    src_water: 'Fire water points',
    src_water_what: 'Where crews and water bombers refill: hydrants, tanks, ponds. It is the only layer aimed at firefighters rather than residents, and the most fragmented data in the app.',
    src_water_where: 'Each register comes from the SDIS or authority that publishes it, through data.gouv.fr. This file is rebuilt with the others, but it only changes when an SDIS updates its register — which is to say rarely.',

    h_cannot: 'What this map cannot do',
    cannot_intro: 'This is the most important section on the page. What this map cannot see matters as much as what it shows, and none of it is softened here.',

    evac_h: 'It cannot see any evacuation order',
    evac_p: 'In France evacuation orders go out over FR-Alert: a message sent straight to the phones inside the affected cell. There is no public feed to read — each prefecture publishes its arrêtés on its own site, as PDFs, and there are 101 of them. So this map cannot see them. All it can show is the hand-kept list.',
    evac_watched: (deps) => `Départements actually being watched right now: ${deps}.`,
    evac_none_short: 'No département watched',
    evac_none: 'No département is being watched right now. So today this map claims nothing at all, anywhere, about evacuations. If no zone appears near you, that does not mean there is no evacuation order: it means we are not looking.',
    evac_unwatched: 'A département missing from that list is treated exactly as if no file existed: we say nothing about it, either way.',
    evac_orders: (n) => `${n} evacuation zone(s) in the file right now.`,

    sdis_h: 'It does not show firefighters on the ground',
    sdis_p: 'The SDIS do not publish live positions for their units, and no aggregator does it for them. Verified 2026-07-29: the 22 open SDIS datasets on data.gouv.fr are budgets and administrative boundaries, not positions. Even the stations are poorly known — OpenStreetMap has 4 fire stations in the whole Gironde bounding box, against a real figure near 100. An empty map means we cannot see them. It never means nobody is there.',

    lag_h: 'It is behind the fire',
    lag_p: 'Satellites do not watch continuously: they pass a few times a day (measured 2026-07-29: five passes over France in 24 hours across both satellites). Between passes nobody is looking. And cloud blocks the sensor outright. A fire that started an hour ago may be entirely absent from this map. Absence of detection is never safety.',

    roads_h: 'It does not see every road closure',
    roads_p: 'The feed covers the réseau routier national only: motorways, routes nationales, and the odd départementale a DIR manages. A préfet closing a communal road beside a fire will never appear here, and neither will anything the CNIR has not yet recorded. On top of that, since the feed carries no coordinates, each closure is placed at its commune centre: the pin can sit several kilometres from the real block.',

    water_h: 'It knows only a small part of the water points',
    water_p: 'Fire water supply is a communal responsibility under a departmental règlement: each SDIS keeps its own register, there is no national authority and therefore no national dataset. We use only the registers actually published and readable.',
    water_share: (points) => `That is ${points} water points, roughly 7% of France’s estimated 800,000. A firefighter who sees no water point must not conclude there is none.`,
    water_capacity: 'Capacity is almost always unknown: most registers publish a flow rate in m³/h, not a stored volume. Flow is never converted into volume, and an unknown volume — or one published as zero — stays shown as unknown. Sending a crew to a tank the map called full is the failure that matters here.',
    water_btn: 'Show the areas actually covered',
    water_btn_loading: 'Loading the register…',
    water_note: 'The water-point file is large; it is only loaded if you ask for it.',
    water_head: (n, points) => `${n} areas covered, ${points} points`,
    water_failed: (msg) => `Could not load the water-point register: ${msg}`,
    scope_dep: 'Whole département', scope_local: 'Local area',
    points_n: (n) => `${n} points`,

    h_dots: 'Why some dots are not fires',
    heat_p: 'FIRMS detects heat, not wildfire. A refinery, a steelworks or a gas flare burns at the same spot every day and looks exactly like a fire from orbit. La Mède and Lacq appear every day; the Fos-sur-Mer flares account for most of Bouches-du-Rhône’s detections. This is not a tidiness problem: once a reader learns to ignore two fixed dots, they ignore the real one beside them too.',
    mask_p: (window, days, marked) => `We do not mark these by hand. A spot is called industrial once it burns at the same place on most days of a ${window}-day window. We have ${days} day(s) of observation so far, and ${marked} spot(s) are marked industrial. A new flare will therefore show as a fire until we have enough days to recognise it. The bias is deliberate: when unsure we do not mask, because showing a refinery is a smaller failure than hiding a fire.`,
    foreign_p: (n, total) => `Fires outside France are drawn faded. The satellite query uses a rectangle, not a border: it reaches into Spain, Belgium, Switzerland and northern Italy. That is wanted — a fire 5 km over the frontier still matters in the Pyrénées-Orientales — but it has to be said, because before this was fixed León in Spain came back as the largest "French" fire on the map. Right now ${n} of the ${total} incidents shown are outside France.`,

    h_not: 'What this is not',
    not_official_h: 'It is not an official source',
    not_official_p: 'Nobody in a prefecture, an SDIS or an operations centre watches this site. It re-publishes public data. When this site and the official source disagree, the official source is right.',
    no_alerts_h: 'It sends no alerts',
    no_alerts_p: 'No notifications, no texts, no sirens. Nothing will reach you if you are not looking at the page. In France public warning goes through FR-Alert, straight to your phone, and through your prefecture’s instructions. Keep your phone on and the sound up.',
    stale_h: 'It can be out of date',
    stale_p: 'We check every 30 minutes, and the sources we read are themselves behind the ground: the danger bulletin comes out once a day, the satellites pass a few times a day. The times on this page are when we last fetched the data, not when the fire moved.',
    emergency_p: 'If you are in immediate danger call 18 or 112 and follow your local authorities. To know what has been decided where you live: your prefecture’s site, and FR-Alert.',
    alert_link: 'FR-Alert', prefecture_link: 'Ministry of the Interior — prefectures',
    generated: (stamp) => `Data file built ${stamp}`,
    failed_page: (msg) => `Data unavailable: ${msg}`,
  },
};

const PREFECTURE_URL = 'https://www.interieur.gouv.fr/';

let lang = load(LANG_KEY) || 'fr';
let summary = null;
let flares = null;
let water = null;
let waterState = '';   // '', 'loading', or an error message

const c = () => COPY[lang === 'en' ? 'en' : 'fr'];

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private browsing */ }
}

const esc = (value) => String(value).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const pick = (field) => (field ? (field[lang === 'en' ? 'en' : 'fr'] ?? field.fr) : '');

// Thousands are grouped: 53 937 is read as a count, 53937 as a reference number.
const num = (value) => Number(value).toLocaleString(lang === 'en' ? 'en-CA' : 'fr-FR');

function minutesSince(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.round((Date.now() - ms) / 60000);
}

// Local wall-clock time for reading, plus the raw UTC stamp from the file, which
// is what makes the claim auditable.
function stamp(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return esc(iso);
  return esc(new Date(ms).toLocaleString(lang === 'en' ? 'en-CA' : 'fr-FR'));
}

function fact(label, valueHtml) {
  return `<div class="fact"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function link(href, text) {
  return `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>`;
}

function bullets(items) {
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

/* ---------------- 1. what each source is ---------------- */

function renderSource(source) {
  const info = SOURCES[source.id];
  const age = minutesSince(source.fetched_at);
  const failed = !source.ok;
  // Three different things, kept apart on purpose. `stale` in the payload means
  // the check failed and the build kept the previous copy; a merely old file
  // means the build itself has not run, which is not the source's fault and must
  // not be reported as a failed fetch.
  const kept = !failed && source.stale;
  const old = age === null || age > 60;
  const state = failed ? c().state_failed : ((kept || old) ? c().state_stale : c().state_ok);
  const note = failed ? c().failed_note : (kept ? c().stale_note : (old ? c().old_note : ''));

  const checked = source.fetched_at
    ? `${stamp(source.fetched_at)}<br><span style="color:var(--faint)">${esc(source.fetched_at)}</span>`
    : `<span class="bad">${esc(c().never)}</span>`;

  const rows = [
    fact(c().lbl_publisher, esc(info ? pick(info.publisher) : source.id)),
    fact(c().lbl_checked, checked),
    fact(c().lbl_state,
      `<span class="tag ${failed || kept || old ? 'caution' : 'safe'}"><i></i>${esc(state)}</span>` +
      (age !== null ? `<br><span style="color:var(--faint)">${esc(c().minutes(age))}</span>` : '')),
    info && info.count ? fact(c().lbl_content, esc(pick(info.count(summary)))) : '',
    info ? fact(c().lbl_host, `<span style="color:var(--faint)">${esc(info.host)}</span>`) : '',
    info ? fact(c().lbl_page, link(info.home, new URL(info.home).hostname)) : '',
  ].join('');

  return `
    <section class="src">
      <div class="prose">
        <h3>${esc(info ? pick(info.publisher) : source.id)}</h3>
        <p>${esc(info ? pick(info.what) : c().unknown)}</p>
        ${info ? `<p><b>${esc(c().lbl_limits)}</b></p>${bullets(pick(info.limits))}` : ''}
        ${note ? `<p style="color:var(--caution)">${esc(note)}</p>` : ''}
      </div>
      <dl class="facts">${rows}</dl>
    </section>`;
}

// The curated evacuation list and the water register are not in summary.sources —
// they are not fetched on a schedule — so they get their own cards, built from
// what those files actually say about themselves.
function renderCuratedCard() {
  const cur = (summary && summary.evacuation_curation) || {};
  const deps = cur.departements || [];
  const rows = [
    fact(c().lbl_kept, esc(cur.curated_by || '—')),
    fact(c().lbl_updated, cur.curated_at
      ? `${stamp(cur.curated_at)}<br><span style="color:var(--faint)">${esc(cur.curated_at)}</span>`
      : `<span class="bad">${esc(c().never)}</span>`),
    fact(c().lbl_content, esc(deps.length ? deps.join(', ') : c().evac_none_short)),
  ].join('');

  return `
    <section class="src">
      <div class="prose">
        <h3>${esc(c().src_evac)}</h3>
        <p>${esc(c().src_evac_what)}</p>
        <p style="color:var(--caution)">${esc(deps.length ? c().evac_unwatched : c().evac_none)}</p>
      </div>
      <dl class="facts">${rows}</dl>
    </section>`;
}

function renderWaterCard() {
  return `
    <section class="src">
      <div class="prose">
        <h3>${esc(c().src_water)}</h3>
        <p>${esc(c().src_water_what)}</p>
        <p>${esc(c().src_water_where)}</p>
      </div>
      <dl class="facts">${fact(c().lbl_page, link('https://www.data.gouv.fr/', 'data.gouv.fr'))}</dl>
    </section>`;
}

/* ---------------- 2. what it cannot do ---------------- */

function renderWaterCoverage() {
  if (waterState === 'loading') return `<div class="prose"><p>${esc(c().water_btn_loading)}</p></div>`;
  if (waterState) return `<div class="prose"><p class="bad" style="color:var(--caution)">${esc(c().water_failed(waterState))}</p></div>`;
  if (!water) {
    return `<div class="prose">
        <p>${esc(c().water_note)}</p>
        <p><button class="btn-ghost" data-water>${esc(c().water_btn)}</button></p>
      </div>`;
  }

  const coverage = water.coverage || [];
  const total = coverage.reduce((sum, a) => sum + (a.count || 0), 0);
  const rows = coverage.map((a) => `
      <div class="fact area">
        <dt><b>${esc(a.dep || '—')}</b> ${esc(a.area || '—')}<br>
          <span style="font-size:0.8rem;color:var(--faint)">${esc(a.scope === 'departement' ? c().scope_dep : c().scope_local)}</span></dt>
        <dd>${esc(c().points_n(num(a.count || 0)))}</dd>
      </div>`).join('');

  return `
    <div class="prose"><p><b>${esc(c().water_head(num(coverage.length), num(total)))}</b></p></div>
    <dl class="facts">${rows}</dl>`;
}

function renderCannot() {
  const cur = (summary && summary.evacuation_curation) || {};
  const deps = cur.departements || [];
  const evacuations = (summary && summary.evacuations) || [];
  // Null until the register is actually loaded. Inventing a count here would be
  // the exact failure this page exists to prevent.
  const points = water ? (water.points || []).length : null;

  const block = (h, p) => `<h3>${esc(c()[h])}</h3><p>${esc(c()[p])}</p>`;

  return `
    <div class="prose">
      <h2>${esc(c().h_cannot)}</h2>
      <p>${esc(c().cannot_intro)}</p>

      <h3>${esc(c().evac_h)}</h3>
      <p>${esc(c().evac_p)}</p>
      <p style="color:var(--caution)">${esc(deps.length ? c().evac_watched(deps.join(', ')) : c().evac_none)}</p>
      ${deps.length ? `<p>${esc(c().evac_unwatched)}</p>` : ''}
      <p>${esc(c().evac_orders(evacuations.length))}</p>

      ${block('sdis_h', 'sdis_p')}
      ${block('lag_h', 'lag_p')}
      ${block('roads_h', 'roads_p')}

      <h3>${esc(c().water_h)}</h3>
      <p>${esc(c().water_p)}</p>
      ${points !== null ? `<p>${esc(c().water_share(num(points)))}</p>` : ''}
      <p>${esc(c().water_capacity)}</p>
    </div>
    ${renderWaterCoverage()}`;
}

/* ---------------- 3. why some dots are not fires ---------------- */

function renderDots() {
  const fires = (summary && summary.fires) || [];
  const foreign = fires.filter((f) => f.in_country === false).length;
  const marked = fires.filter((f) => f.industrial).length;
  const windowDays = flares ? (flares.window_days ?? '?') : '?';
  const days = flares
    ? new Set((flares.sites || []).flatMap((s) => s.days || [])).size
    : '?';

  return `
    <div class="prose">
      <h2>${esc(c().h_dots)}</h2>
      <p>${esc(c().heat_p)}</p>
      <p>${esc(c().mask_p(windowDays, days, marked))}</p>
      <p>${esc(c().foreign_p(foreign, fires.length))}</p>
    </div>`;
}

/* ---------------- 4. what it is not ---------------- */

function renderNot() {
  const coverage = ((summary && summary.coverage) || [])[0] || {};
  const alertUrl = coverage.official_url || 'https://www.interieur.gouv.fr/Alerte/FR-Alert';
  const block = (h, p) => `<h3>${esc(c()[h])}</h3><p>${esc(c()[p])}</p>`;

  return `
    <div class="prose">
      <h2>${esc(c().h_not)}</h2>
      ${block('not_official_h', 'not_official_p')}
      ${block('no_alerts_h', 'no_alerts_p')}
      ${block('stale_h', 'stale_p')}
    </div>
    <div class="official">
      <p>${esc(c().emergency_p)}</p>
      ${link(alertUrl, c().alert_link)}
      <br>${link(PREFECTURE_URL, c().prefecture_link)}
    </div>`;
}

/* ---------------- page ---------------- */

function render() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'fr';
  document.title = `${c().title} — ${lang === 'en' ? 'Fire Near Me' : 'Feux Près De Moi'}`;
  $('lang').textContent = c().lang;
  $('back').textContent = c().back;

  if (!summary) return;
  const sources = summary.sources || [];

  $('content').innerHTML = `
    <div class="prose">
      <h1>${esc(c().title)}</h1>
      <p>${esc(c().intro)}</p>
      <h2>${esc(c().h_sources)}</h2>
      <p>${esc(c().sources_intro)}</p>
    </div>
    ${sources.map(renderSource).join('')}
    ${renderCuratedCard()}
    ${renderWaterCard()}
    ${renderCannot()}
    ${renderDots()}
    ${renderNot()}`;

  // Same rule as the map shell: the oldest source decides, and a failed check
  // makes the whole page stale.
  const ages = sources.map((s) => minutesSince(s.fetched_at)).filter((m) => m !== null);
  const age = ages.length ? Math.max(...ages) : null;
  const stale = age === null || age > 60 || sources.some((s) => s.stale || !s.ok);
  $('freshness').className = stale ? 'live stale' : 'live';
  $('freshness-text').textContent = age === null
    ? c().state_failed
    : c().minutes(age) + (stale ? ` — ${c().state_stale}` : '');
  $('generated').textContent = c().generated(summary.generated_at || '?');
}

// The register is several megabytes — far more than the rest of the page — so it
// is fetched only when a reader asks for the covered areas.
function loadWater() {
  if (water || waterState === 'loading') return;
  waterState = 'loading';
  render();
  fetch('data/water.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`water.json: ${r.status}`); return r.json(); })
    .then((data) => { water = data; waterState = ''; render(); })
    .catch((error) => { waterState = error.message; render(); });
}

$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'fr' : 'en';
  store(LANG_KEY, lang);
  render();
});

$('content').addEventListener('click', (event) => {
  if (event.target.closest('[data-water]')) loadWater();
});

render();

// Page-relative, not root-absolute: on a project page the site lives under
// /fire-app/, where '/fr/data/summary.json' 404s.
fetch('data/summary.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(`summary.json: ${r.status}`); return r.json(); })
  .then((data) => { summary = data; render(); })
  .catch((error) => {
    // Failing loudly beats a page that quietly claims nothing is wrong.
    $('content').innerHTML =
      `<div class="prose"><h1>${esc(c().title)}</h1><p class="bad">${esc(c().failed_page(error.message))}</p></div>`;
  });

// The industrial-mask history. Small, and it is what lets section 3 state how
// many days of observation exist instead of implying the mask is already working.
fetch('data/flares.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => { flares = data; render(); })
  .catch(() => { /* section 3 then shows '?' days rather than a made-up number */ });
