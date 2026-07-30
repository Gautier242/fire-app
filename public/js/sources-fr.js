// The French audit page. Every timestamp, every count and every coverage claim
// is read out of the published data files, so this page cannot drift away from
// what the map is actually serving. Nothing about freshness is written here.
//
// Copy lives in COPY below, the same pattern as app-fr.js, and deliberately not
// in i18n.js: that table is the Canadian one and tests-js/test_i18n.js asserts
// its two key sets are exactly equal, so French-only keys would break it.
//
// The imagery catalogue and the Overpass zoom floor are imported rather than
// restated: what this page lists is then exactly what the map ships, and a layer
// swapped in imagery.js cannot leave a stale claim here.
import { LAYERS } from './imagery.js';
import { MIN_ZOOM } from './overpass.js';

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

    /* ---- la vue locale : vent, relief, fond de carte, imagerie, modèle ---- */

    h_local: 'La vue locale et ce qui la nourrit',
    local_intro: "La vue à 50 km autour d'un point utilise des sources que la carte nationale n'a pas besoin d'ouvrir : le vent à haute résolution, le relief, le fond de carte officiel, les images satellites datées, et un modèle de propagation. Le dernier est un calcul et non une observation ; il est décrit en dernier, en détail, parce que c'est celui qui peut tromper.",
    lbl_layers: 'Couches proposées', lbl_model: 'Modèle', lbl_validated: 'Validé',
    lbl_reference: 'Référence', lbl_fuel: 'Combustible supposé', lbl_horizon: 'Horizon',
    lbl_zone: 'Lu dans la zone', lbl_zoom: 'Zoom minimal', lbl_resolution: 'Résolution',
    not_validated: 'Non validé contre un feu réel',
    zone_absent: 'Aucune zone pré-construite en ce moment',

    arome_h: 'AROME 1,3 km — vent et rafales, via Open-Meteo',
    arome_p1: "Le modèle à haute résolution de Météo-France, à 1,3 km de maille, heure par heure. Nous le lisons par l'API gratuite d'Open-Meteo : pas de clé, pas de compte, pas de quota payant. La carte nationale se contente d'un vent à environ 11 km pour une heure ; ici c'est la prévision sur les heures qui viennent, à la résolution à laquelle un feu réagit.",
    arome_p2: "Ce sont les RAFALES qui font courir un feu, pas la moyenne. Mesuré à Lacanau le 29 juillet 2026 : 8,8 km/h de vent moyen contre 32,0 km/h de rafales. Une projection calculée sur la seule moyenne serait fausse d'un facteur proche de quatre, et c'est pourquoi la rafale est affichée à côté du vent moyen partout où elle apparaît.",
    arome_limits: [
      "C'est une prévision, pas une mesure : personne ne relève le vent dans votre rue.",
      "Le vent est donné à 10 m de hauteur, puis réduit à la hauteur de flamme par le modèle. Cette réduction est une approximation de plus.",
      "Une valeur par heure. Une rafale de trois minutes n'y figure pas, et c'est parfois elle qui fait la journée.",
    ],
    arome_zone: (hours, mean, gust) => `${hours} h de prévision : jusqu'à ${mean} km/h de vent moyen, jusqu'à ${gust} km/h de rafales`,

    alti_h: 'IGN RGE ALTI — altitude et pente',
    alti_p1: "L'altitude publiée par l'IGN, gratuite et sans clé. Elle sert à calculer la pente, parce qu'un feu monte beaucoup plus vite qu'il ne se propage à plat : le modèle de Rothermel utilise tan(pente) au carré, donc une pente sous-estimée sous-estime la vitesse de façon très non linéaire. Un habitant a besoin de savoir qu'un feu en dessous de chez lui arrive plus tôt que la distance sur la carte ne le suggère.",
    alti_limits: [
      "Échantillonnée sur une grille grossière, pas au 1 m : un talus, un ravin, une piste en corniche n'y sont pas. Une zone de 50 km au mètre représenterait des milliards de points.",
      "La pente n'est pas une propriété du sol seul mais de la distance sur laquelle on la mesure : changer le pas d'échantillonnage change le chiffre. L'échelle fait partie de la réponse.",
      "Hors couverture, le service renvoie −99999 au lieu d'une absence. Lu tel quel ce serait une falaise de cent kilomètres, donc la valeur est écartée. À l'inverse 0 n'est pas une absence : c'est le niveau de la mer.",
    ],

    geopf_h: 'IGN Plan v2 et photographie aérienne — data.geopf.fr',
    geopf_p1: "Le fond de carte officiel français (IGN Plan v2) et l'orthophotographie à 20 cm, servis par la Géoplateforme de l'IGN sans clé ni compte. C'est ce qui permet de lire le nom de sa rue et de reconnaître son propre toit, ce qu'aucun fond de carte mondial ne fait aussi bien en France. La même plateforme fournit la recherche d'adresse de ce site.",
    geopf_limits: [
      "La photographie aérienne a plusieurs années : elle montre le terrain, jamais le feu du jour.",
      "Couverture française. Un feu de l'autre côté de la frontière est affiché, mais sur un fond de carte qui s'arrête.",
    ],

    osm_h: 'OpenStreetMap via Overpass — bâtiments et rues',
    osm_p1: "Les bâtiments et les rues, chargés uniquement pour ce qui est visible à l'écran, jamais pour la France entière. C'est de l'arithmétique et non une préférence : la densité mesurée près de Lacanau est de 123 bâtiments/km², donc un rayon de 50 km représente environ 966 000 bâtiments et un rayon de 100 km environ 3,85 millions — ni Overpass ni un navigateur ne le supportent. Le même contenu par écran fait environ 7 400 bâtiments au zoom 13 et 490 au zoom 15.",
    osm_limits: [
      "Rien n'est chargé en dessous du zoom indiqué ci-dessous : plus loin, un écran couvre plus de terrain qu'Overpass n'en rend.",
      "Overpass est un service bénévole et gratuit. Une requête par déplacement de carte, jamais sans cadre, jamais sans délai maximal.",
      "OpenStreetMap est contributif : une maison neuve ou une piste forestière peut manquer, et l'absence d'un bâtiment ne veut pas dire qu'il n'y a personne.",
    ],

    gibs_h: 'NASA GIBS — les images satellites datées',
    gibs_p1: "Les couches satellites que vous pouvez choisir, avec leur date, servies par NASA GIBS. Résolution et fréquence s'échangent : VIIRS et MODIS repassent tous les jours mais voient à 375 m et 250 m, tandis que les couches à 30 m sont nettes mais ne revoient un endroit donné que tous les quelques jours.",
    gibs_p2: "Sentinel-2 à 10 m est la couche la plus fine disponible ici, mais c'est un COMPOSITE ANNUEL et non l'image du jour. Une image Sentinel-2 datée exige un compte Copernicus que ce projet n'a pas : ce n'est pas une limite technique, c'est une inscription qui n'a pas été faite. L'étiquette de la couche le dit au lieu de laisser croire qu'elle est actuelle.",
    gibs_p3: "Deux couches prévues au départ n'ont pas survécu à la vérification sur une vraie tuile. Landsat WELD est vivante mais son étendue temporelle s'arrête en 2001 : comme option « mensuelle à 30 m » elle serait restée définitivement blanche, et elle est remplacée par HLS L30, le même capteur à la même résolution, daté chaque jour. Et toutes les couches d'anomalies thermiques MODIS et VIIRS ne sont plus publiées qu'en tuiles vectorielles, qu'un Leaflet sans extension ne sait pas dessiner ; à leur place, OPERA DIST-ALERT montre la végétation détruite à 30 m, qui est justement ce qui rend visible la progression d'un feu quand on remonte les dates. Les détections de feu elles-mêmes ne sont pas perdues : elles arrivent en points par FIRMS.",
    gibs_p4: "Une tuile absente à une date donnée n'est pas une panne : cela veut dire qu'aucun satellite n'est passé sur ce carré ce jour-là. La tuile reste blanche, ce qui est la lecture honnête de « personne n'a regardé ».",

    spread_h: 'Le modèle de propagation — Rothermel 1972',
    spread_p1: "La projection de propagation est la seule chose sur cette carte qui ne soit pas une observation. C'est un calcul. Le modèle est celui de Rothermel (1972), le modèle de propagation de feu de surface le plus utilisé au monde, implémenté dans la notation d'Andrews 2018 (RMRS-GTR-371) qui le reformule.",
    spread_p2: "Ce qui est affirmé ici est étroit et vérifiable : c'est une implémentation correcte d'un modèle publié et relu par des pairs. Elle est contrôlée contre la valeur publiée du RMRS-GTR-371, page 59, table 17, première ligne — 81,6 ft/min publiés, 24,876 m/min calculés, soit un écart de 0,02 %. Les valeurs intermédiaires de la même ligne (densité apparente, taux de compacité, facteur de vent) sont reproduites elles aussi.",
    spread_p3: "Ce qui n'est PAS affirmé : ce modèle n'est validé contre aucun comportement de feu réel. Personne sur ce projet ne peut le faire, et un feu réel dépend de la végétation exacte, de l'humidité du sol, du relief fin et de l'action des secours, dont rien n'est ici. La projection est indicative, et seulement indicative. Elle ne remplace jamais les consignes officielles : en cas de danger, ce sont la préfecture, les pompiers et FR-Alert qui décident, pas cette carte.",
    spread_limits: [
      "Un seul modèle de combustible pour toute la zone (FM5, garrigue basse), là où la végétation réelle change tous les cent mètres. C'est la plus grosse imprécision du calcul.",
      "Une seule classe de combustible mort à 1 heure, quand le modèle complet en pondère plusieurs. L'écart compte surtout en maquis mélangé.",
      "L'humidité du combustible est estimée depuis l'humidité de l'air. Elle n'est pas mesurée.",
      "Deux arcs et non une ligne : un sur le vent moyen, un sur les rafales. Une ligne unique impliquerait une précision que ce modèle n'a pas.",
      "Aucun saut de feu par braises, aucun effet de cheminée, aucune action de lutte.",
    ],
    spread_ref: 'Andrews 2018, RMRS-GTR-371, p. 59, table 17 — écart 0,02 %',
    spread_validated: (validated) => (validated
      ? 'Le fichier de données déclare cette projection validée.'
      : "Lu dans le fichier de données : validated = false. Cette page ne l'écrit pas à la main, elle le lit là où le calcul le publie."),

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
    water_loading: 'Chargement du registre…',
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

    /* ---- the local view: wind, terrain, base map, imagery, model ---- */

    h_local: 'The local view and what feeds it',
    local_intro: 'The 50 km view around a point uses sources the national map never needs to open: high-resolution wind, terrain, the official base map, dated satellite imagery, and a spread model. The last one is a calculation rather than an observation; it is described last and in detail, because it is the one that can mislead.',
    lbl_layers: 'Layers offered', lbl_model: 'Model', lbl_validated: 'Validated',
    lbl_reference: 'Reference', lbl_fuel: 'Assumed fuel', lbl_horizon: 'Horizon',
    lbl_zone: 'Read from the zone', lbl_zoom: 'Minimum zoom', lbl_resolution: 'Resolution',
    not_validated: 'Not validated against real fire',
    zone_absent: 'No pre-built zone right now',

    arome_h: 'AROME 1.3 km — wind and gusts, via Open-Meteo',
    arome_p1: "Météo-France's high-resolution model, on a 1.3 km grid, hour by hour. We read it through Open-Meteo's free endpoint: no key, no account, no paid quota. The national map makes do with wind at roughly 11 km for a single hour; this is the forecast over the coming hours, at the resolution a fire actually responds to.",
    arome_p2: 'GUSTS are what drive a fire run, not the average. Measured at Lacanau on 2026-07-29: mean wind 8.8 km/h against gusts of 32.0 km/h. A projection computed on the mean alone would be wrong by close to a factor of four, which is why the gust is shown beside the mean everywhere it appears.',
    arome_limits: [
      'It is a forecast, not a measurement: nobody is reading the wind in your street.',
      'Wind is given at 10 m and then reduced to flame height by the model. That reduction is one more approximation.',
      'One value per hour. A three-minute gust is not in it, and sometimes that is the gust that makes the day.',
    ],
    arome_zone: (hours, mean, gust) => `${hours} h of forecast: up to ${mean} km/h mean wind, up to ${gust} km/h gusts`,

    alti_h: 'IGN RGE ALTI — elevation and slope',
    alti_p1: 'Elevation published by IGN, free and keyless. It is used to compute slope, because fire runs uphill far faster than it spreads on the flat: the Rothermel model uses tan(slope) squared, so an underestimated slope underestimates speed very non-linearly. A resident needs to know that a fire below them arrives sooner than the map distance suggests.',
    alti_limits: [
      'Sampled on a coarse grid, not at 1 m: a bank, a gully, a cliff-edge track are not in it. A 50 km zone at one metre would be billions of points.',
      'Slope is not a property of the ground alone but of the distance it is measured over: change the sampling step and the number changes. The scale is part of the answer.',
      'Outside coverage the service returns −99999 instead of an absence. Read literally that is a hundred-kilometre cliff, so the value is discarded. Conversely 0 is not missing: it is sea level.',
    ],

    geopf_h: 'IGN Plan v2 and aerial imagery — data.geopf.fr',
    geopf_p1: "France's official base map (IGN Plan v2) and the 20 cm orthophoto, served by IGN's Géoplateforme with no key and no account. This is what lets you read your own street name and recognise your own roof, which no global base map does as well in France. The same platform provides this site's address search.",
    geopf_limits: [
      'The aerial photography is several years old: it shows the ground, never today’s fire.',
      'French coverage. A fire across the border is still drawn, but on a base map that stops.',
    ],

    osm_h: 'OpenStreetMap via Overpass — buildings and streets',
    osm_p1: 'Buildings and streets, loaded only for what is visible on screen, never for the whole of France. That is arithmetic rather than preference: measured density near Lacanau is 123 buildings/km², so a 50 km radius is about 966,000 buildings and a 100 km radius about 3.85 million — neither loadable by Overpass nor survivable by a browser. The same data by viewport is roughly 7,400 buildings at zoom 13 and 490 at zoom 15.',
    osm_limits: [
      'Nothing is loaded below the zoom shown below: further out, one screen covers more ground than Overpass will return.',
      'Overpass is a free, volunteer-run service. One query per map move, never without a bounding box, never without a timeout.',
      'OpenStreetMap is contributed: a new house or a forest track can be missing, and a missing building does not mean nobody is there.',
    ],

    gibs_h: 'NASA GIBS — the dated satellite imagery',
    gibs_p1: 'The satellite layers you can choose, with their date, served by NASA GIBS. Resolution and cadence trade against each other: VIIRS and MODIS come back every day but see at 375 m and 250 m, while the 30 m layers are sharp but only revisit a given place every few days.',
    gibs_p2: 'Sentinel-2 at 10 m is the sharpest layer here, but it is an ANNUAL COMPOSITE, not today’s image. A dated Sentinel-2 scene needs a Copernicus account this project does not have: that is not a technical limit, it is a registration nobody did. The layer’s own label says so rather than letting it read as current.',
    gibs_p3: 'Two layers planned at the start did not survive being checked against a real tile. Landsat WELD is alive but its time extent ends in 2001: as a "monthly 30 m" option it would have been permanently blank, and it is replaced by HLS L30 — the same sensor at the same resolution, dated daily. And every MODIS and VIIRS thermal-anomaly layer is now published as vector tiles only, which a Leaflet with no plugin cannot draw; in their place OPERA DIST-ALERT shows vegetation loss at 30 m, which is exactly what makes a burn’s progress visible when you scrub the date back. The fire detections themselves are not lost: they arrive as points through FIRMS.',
    gibs_p4: 'A missing tile on a given date is not a fault: it means no satellite passed over that square that day. The tile stays blank, which is the honest rendering of "nobody looked".',

    spread_h: 'The spread model — Rothermel 1972',
    spread_p1: 'The spread projection is the only thing on this map that is not an observation. It is a calculation. The model is Rothermel (1972), the most widely used surface fire spread model in the world, implemented in the notation of Andrews 2018 (RMRS-GTR-371), which restates it.',
    spread_p2: 'What is claimed here is narrow and checkable: it is a correct implementation of a published, peer-reviewed model. It is checked against the published value in RMRS-GTR-371, page 59, table 17, first row — 81.6 ft/min published against 24.876 m/min computed, a deviation of 0.02%. The intermediate values in the same row (bulk density, packing ratio, wind factor) are reproduced too.',
    spread_p3: 'What is NOT claimed: this model is not validated against any real fire behaviour. Nobody on this project can do that, and a real fire depends on the exact vegetation, soil moisture, fine terrain and the action of the crews, none of which is here. The projection is indicative, and only indicative. It never replaces official instructions: in danger it is the prefecture, the fire service and FR-Alert that decide, not this map.',
    spread_limits: [
      'One fuel model for the whole zone (FM5, low garrigue), where real vegetation changes every hundred metres. It is the largest inaccuracy in the calculation.',
      'A single dead 1-hour fuel class, where the full model weights several. The gap matters most in mixed maquis.',
      'Fuel moisture is estimated from air humidity. It is not measured.',
      'Two arcs rather than one line: one on the mean wind, one on gusts. A single line would imply a precision this model does not have.',
      'No ember spotting, no chimney effect, no suppression.',
    ],
    spread_ref: 'Andrews 2018, RMRS-GTR-371, p. 59, table 17 — deviation 0.02%',
    spread_validated: (validated) => (validated
      ? 'The data file declares this projection validated.'
      : 'Read from the data file: validated = false. This page does not write that by hand, it reads it where the calculation publishes it.'),

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
    water_loading: 'Loading the register…',
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
let zone = null;       // one pre-built zone, for the local view's live numbers
let waterState = 'loading';   // 'loading', '', or an error message

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

/* ---------------- 1b. the local view's own sources ---------------- */

// Same shape as renderSource, for sources that carry no fetch record of their
// own: the base map, the imagery tiles and Overpass are fetched by the browser
// when you look at them, and the spread model is computed rather than fetched.
function card(title, paras, limits, rows) {
  return `
    <section class="src">
      <div class="prose">
        <h3>${esc(title)}</h3>
        ${paras.filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('')}
        ${limits && limits.length ? `<p><b>${esc(c().lbl_limits)}</b></p>${bullets(limits)}` : ''}
      </div>
      ${rows ? `<dl class="facts">${rows}</dl>` : ''}
    </section>`;
}

function renderLocal() {
  // Read out of a real pre-built zone where there is one. With no zone the rows
  // say so: an invented gust would be the exact failure this page exists to
  // prevent, and the local view still works by fetching live.
  const wind = (zone && zone.wind) || [];
  const projection = ((zone && zone.spread) || [])[0] || null;
  const worst = (key) => num(Math.max(...wind.map((row) => row[key] || 0)));

  const aromeRows = wind.length
    ? fact(c().lbl_zone, esc(c().arome_zone(wind.length, worst('wind_kmh'), worst('gust_kmh'))))
    : fact(c().lbl_zone, esc(c().zone_absent));

  const layerRows = LAYERS.map((layer) => `
      <div class="fact area">
        <dt>${esc(pick(layer.label))}</dt>
        <dd><span style="color:var(--faint)">${esc(layer.attribution)}</span></dd>
      </div>`).join('');

  // The model's own claim about itself, read where it is published rather than
  // asserted here. A payload that ever said validated=true would show up here.
  const validated = projection
    ? `<span class="tag ${projection.validated ? 'safe' : 'caution'}"><i></i>${
      esc(projection.validated ? c().lbl_validated : c().not_validated)}</span>`
    : esc(c().zone_absent);

  return `
    <div class="prose">
      <h2>${esc(c().h_local)}</h2>
      <p>${esc(c().local_intro)}</p>
    </div>
    ${card(c().arome_h, [c().arome_p1, c().arome_p2], c().arome_limits,
    aromeRows +
      fact(c().lbl_host, '<span style="color:var(--faint)">api.open-meteo.com</span>') +
      fact(c().lbl_page, link('https://open-meteo.com/en/docs/meteofrance-api', 'open-meteo.com')))}
    ${card(c().alti_h, [c().alti_p1], c().alti_limits,
    fact(c().lbl_host, '<span style="color:var(--faint)">data.geopf.fr</span>') +
      fact(c().lbl_page, link('https://geoservices.ign.fr/rgealti', 'geoservices.ign.fr')))}
    ${card(c().geopf_h, [c().geopf_p1], c().geopf_limits,
    fact(c().lbl_host, '<span style="color:var(--faint)">data.geopf.fr</span>') +
      fact(c().lbl_page, link('https://geoservices.ign.fr/', 'geoservices.ign.fr')))}
    ${card(c().osm_h, [c().osm_p1], c().osm_limits,
    fact(c().lbl_zoom, esc(String(MIN_ZOOM))) +
      fact(c().lbl_host, '<span style="color:var(--faint)">overpass-api.de</span>') +
      fact(c().lbl_page, link('https://www.openstreetmap.org/copyright', 'openstreetmap.org')))}
    ${card(c().gibs_h, [c().gibs_p1, c().gibs_p2, c().gibs_p3, c().gibs_p4], null,
    fact(c().lbl_layers, esc(num(LAYERS.length))) + layerRows +
      fact(c().lbl_page, link('https://worldview.earthdata.nasa.gov/', 'earthdata.nasa.gov')))}
    ${card(c().spread_h,
    [c().spread_p1, c().spread_p2, c().spread_p3,
      projection ? c().spread_validated(projection.validated) : null],
    c().spread_limits,
    fact(c().lbl_model, esc(projection ? projection.model : c().zone_absent)) +
      fact(c().lbl_validated, validated) +
      fact(c().lbl_fuel, esc(projection ? projection.fuel_model : c().zone_absent)) +
      fact(c().lbl_horizon, esc(projection ? `${projection.hours} h` : c().zone_absent)) +
      fact(c().lbl_reference, esc(c().spread_ref)))}`;
}

/* ---------------- 2. what it cannot do ---------------- */

// How many water points the registers hold, nationally. Summed from the
// coverage rows because water.json no longer ships the points themselves —
// every row counts exactly the points it contributed, so the sum is the total.
// Null until the file lands: inventing a count here would be the exact failure
// this page exists to prevent.
function waterTotal() {
  return water ? (water.coverage || []).reduce((sum, a) => sum + (a.count || 0), 0) : null;
}

function renderWaterCoverage() {
  if (waterState === 'loading') return `<div class="prose"><p>${esc(c().water_loading)}</p></div>`;
  if (waterState) return `<div class="prose"><p class="bad" style="color:var(--caution)">${esc(c().water_failed(waterState))}</p></div>`;
  if (!water) return '';

  const coverage = water.coverage || [];
  const total = waterTotal();
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
  const points = waterTotal();

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
    ${renderLocal()}
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

// The coverage statement, which is all this file now carries: 0.36 KB against
// the 9.1 MB of coordinates it used to ship to a page that draws no map. Small
// enough to load with everything else, so the reader no longer has to ask.
// A failure keeps its own state rather than falling through to an empty list,
// which would read as no register covering anywhere in France.
fetch('data/water.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(`water.json: ${r.status}`); return r.json(); })
  .then((data) => { water = data; waterState = ''; render(); })
  .catch((error) => { waterState = error.message; render(); });

$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'fr' : 'en';
  store(LANG_KEY, lang);
  render();
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

// One pre-built zone, so the local-view section can quote a real gust and read
// the spread model's own `validated` flag instead of restating it. Zones are an
// optimisation and may legitimately be absent; the section then says so.
fetch('data/zones/index.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((index) => {
    const first = ((index && index.zones) || [])[0];
    if (!first) return null;
    return fetch(`data/zones/${first.id}.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null));
  })
  .then((data) => { zone = data; render(); })
  .catch(() => { /* the local section then reports no pre-built zone */ });

// The industrial-mask history. Small, and it is what lets section 3 state how
// many days of observation exist instead of implying the mask is already working.
fetch('data/flares.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => { flares = data; render(); })
  .catch(() => { /* section 3 then shows '?' days rather than a made-up number */ });
