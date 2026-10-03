/**
 * Demo data: people, properties and reviews that src/db/seed.ts inserts into a
 * fresh local database. Pure data with no imports, so the end-to-end tests can
 * import it (by relative path) to find what they expect on the pages.
 *
 * Kennitalas are "Gervimaður" test numbers (010130-xxx9) and a test company
 * (450535-2068), which only parse when test kennitalas are allowed (see
 * allowTestKennitalas in src/lib/kennitala.ts). Reviews talk about deposits,
 * indexed rent, damp, heating, laundry, noise and parking, and never claim that
 * anyone owes or failed to pay money.
 */

type Role = "landlord" | "renter";

/** Password of every demo account. Only ever used for local/demo data. */
export const DEMO_PASSWORD = "password123";

export type DemoPerson = {
  key: string;
  name: string;
  /** 10 digits, no separator. */
  kennitala: string;
  isCompany: boolean;
  /**
   * The roles the seeded row has: an account's are the ones it signed up with;
   * a profile without an account has exactly the roles its reviews and property
   * links give it.
   */
  roles: readonly Role[];
  hasAccount: boolean;
  /** Accounts only. */
  email?: string;
  city?: string;
  bio?: string;
  joinedDaysAgo?: number;
};

export const DEMO_PEOPLE = [
  {
    key: "sigrun",
    name: "Sigrún Helgadóttir",
    kennitala: "0101302129",
    isCompany: false,
    roles: ["landlord"],
    hasAccount: true,
    email: "sigrun@example.com",
    city: "Reykjavík",
    bio: "Leigi út tvær íbúðir í miðbænum og Vesturbænum. Svara yfirleitt samdægurs.",
    joinedDaysAgo: 400,
  },
  {
    key: "olafur",
    name: "Ólafur Þór Gunnarsson",
    kennitala: "0101302209",
    isCompany: false,
    roles: ["landlord", "renter"],
    hasAccount: true,
    email: "olafur@example.com",
    city: "Akureyri",
    bio: "Á íbúð á Brekkunni á Akureyri og leigi sjálfur í Reykjavík þegar ég er þar vegna vinnu.",
    joinedDaysAgo: 380,
  },
  {
    key: "kari",
    name: "Kári Snær Einarsson",
    kennitala: "0101302399",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "kari@example.com",
    city: "Kópavogur",
    bio: "Verkfræðinemi. Rólegur og snyrtilegur.",
    joinedDaysAgo: 300,
  },
  {
    key: "asdis",
    name: "Ásdís Halldórsdóttir",
    kennitala: "0101302479",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "asdis@example.com",
    city: "Hafnarfjörður",
    bio: "Hjúkrunarfræðingur á vöktum. Bý með kettinum Mosa.",
    joinedDaysAgo: 280,
  },
  {
    key: "agnieszka",
    name: "Agnieszka Nowak",
    kennitala: "0101302559",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "agnieszka@example.com",
    city: "Reykjanesbær",
    bio: "I work at the airport and I'm learning Icelandic.",
    joinedDaysAgo: 200,
  },
  {
    key: "birta",
    name: "Birta Líf Kristinsdóttir",
    kennitala: "0101302639",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "birta@example.com",
    city: "Akureyri",
    bio: "Nemi við Háskólann á Akureyri.",
    joinedDaysAgo: 190,
  },
  {
    key: "gunnar",
    name: "Gunnar Már Pétursson",
    kennitala: "0101302719",
    isCompany: false,
    roles: ["landlord"],
    hasAccount: false,
  },
  {
    key: "leigufelag",
    name: "Dæmi leigufélag ehf.",
    kennitala: "4505352068",
    isCompany: true,
    roles: ["landlord"],
    hasAccount: false,
  },
  {
    key: "jon",
    name: "Jón Ingi Bjarnason",
    kennitala: "0101302989",
    isCompany: false,
    roles: ["landlord"],
    hasAccount: true,
    email: "jon@example.com",
    city: "Selfoss",
    bio: "Leigi út íbúðir á Selfossi og sé sjálfur um viðhaldið.",
    joinedDaysAgo: 350,
  },
  {
    key: "helga",
    name: "Helga Rún Sigurðardóttir",
    kennitala: "0101303019",
    isCompany: false,
    roles: ["landlord"],
    hasAccount: true,
    email: "helga@example.com",
    city: "Hafnarfjörður",
    bio: "Leigði út íbúðina mína í Hafnarfirði á meðan ég bjó erlendis.",
    joinedDaysAgo: 330,
  },
  {
    key: "thordis",
    name: "Þórdís Eva Jóhannsdóttir",
    kennitala: "0101303369",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "thordis@example.com",
    city: "Selfoss",
    bio: "Leikskólakennari og hlaupari.",
    joinedDaysAgo: 260,
  },
  {
    key: "magnus",
    name: "Magnús Örn Stefánsson",
    kennitala: "0101304339",
    isCompany: false,
    roles: ["renter"],
    hasAccount: false,
  },
  {
    key: "eva",
    name: "Eva María Guðmundsdóttir",
    kennitala: "0101304929",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "eva@example.com",
    city: "Reykjavík",
    bio: "Grafískur hönnuður sem vinnur mikið heima.",
    joinedDaysAgo: 240,
  },
  {
    key: "david",
    name: "Davíð Þór Ragnarsson",
    kennitala: "0101305069",
    isCompany: false,
    roles: ["renter"],
    hasAccount: false,
  },
  {
    key: "sunna",
    name: "Sunna Björk Aradóttir",
    kennitala: "0101307789",
    isCompany: false,
    roles: ["renter"],
    hasAccount: true,
    email: "sunna@example.com",
    city: "Kópavogur",
    bio: "Flutti heim frá Danmörku í fyrra.",
    joinedDaysAgo: 150,
  },
] as const satisfies readonly DemoPerson[];

export type DemoPersonKey = (typeof DEMO_PEOPLE)[number]["key"];

export type DemoProperty = {
  key: string;
  address: string;
  /** The apartment, as stored (without "íbúð"). */
  unit?: string;
  postalCode: number;
  description: string;
  landlord: DemoPersonKey;
  createdBy: DemoPersonKey;
  addedDaysAgo: number;
};

export const DEMO_PROPERTIES = [
  {
    key: "njalsgata",
    address: "Njálsgata 23",
    unit: "0201",
    postalCode: 101,
    description: "Tveggja herbergja íbúð á annarri hæð í gömlu timburhúsi.",
    landlord: "sigrun",
    createdBy: "sigrun",
    addedDaysAgo: 200,
  },
  {
    key: "hringbraut",
    address: "Hringbraut 79",
    postalCode: 107,
    description: "Stúdíóíbúð í kjallara með sérinngangi.",
    landlord: "sigrun",
    createdBy: "olafur",
    addedDaysAgo: 190,
  },
  {
    key: "hamraborg",
    address: "Hamraborg 14",
    unit: "0503",
    postalCode: 200,
    description: "Þriggja herbergja íbúð í lyftuhúsi með svölum.",
    landlord: "gunnar",
    createdBy: "kari",
    addedDaysAgo: 180,
  },
  {
    key: "strandgata",
    address: "Strandgata 31",
    postalCode: 220,
    description: "Lítil íbúð á jarðhæð nálægt höfninni.",
    landlord: "leigufelag",
    createdBy: "asdis",
    addedDaysAgo: 170,
  },
  {
    key: "hafnargata",
    address: "Hafnargata 50",
    postalCode: 230,
    description: "Tveggja herbergja íbúð á efri hæð.",
    landlord: "leigufelag",
    createdBy: "agnieszka",
    addedDaysAgo: 160,
  },
  {
    key: "thorunnarstraeti",
    address: "Þórunnarstræti 112",
    postalCode: 600,
    description: "Fjögurra herbergja íbúð á Brekkunni.",
    landlord: "olafur",
    createdBy: "olafur",
    addedDaysAgo: 150,
  },
  {
    key: "austurvegur",
    address: "Austurvegur 22",
    postalCode: 800,
    description: "Raðhúsíbúð með litlum garði.",
    landlord: "jon",
    createdBy: "thordis",
    addedDaysAgo: 140,
  },
] as const satisfies readonly DemoProperty[];

export type DemoPropertyKey = (typeof DEMO_PROPERTIES)[number]["key"];

export type DemoReview = {
  author: DemoPersonKey;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  daysAgo: number;
} & ({ landlord: DemoPersonKey } | { renter: DemoPersonKey } | { property: DemoPropertyKey });

export const DEMO_REVIEWS: readonly DemoReview[] = [
  // Renters reviewing landlords
  {
    author: "eva",
    landlord: "sigrun",
    rating: 5,
    title: "Sanngjörn og fljót að svara",
    body: "Sigrún svaraði alltaf samdægurs og lét laga lekann í baðherberginu innan viku. Leigusamningurinn var skýr og tryggingin var endurgreidd að fullu þegar ég flutti út.",
    daysAgo: 30,
  },
  {
    author: "olafur",
    landlord: "sigrun",
    rating: 4,
    title: "Góð samskipti og skýr samningur",
    body: "Leigan er vísitölutengd og hækkaði því nokkrum sinnum á samningstímanum, en það stóð skýrt í samningnum. Sigrún lætur alltaf vita með góðum fyrirvara áður en hún kemur í íbúðina.",
    daysAgo: 60,
  },
  {
    author: "kari",
    landlord: "gunnar",
    rating: 2,
    title: "Rakinn var lengi óviðgerður",
    body: "Það kom raki og mygla í svefnherbergisvegginn fyrsta veturinn. Gunnar kom og skoðaði aðstæður en viðgerðin dróst í hálft ár. Tryggingin skilaði sér á endanum en það tók nokkrar vikur.",
    daysAgo: 45,
  },
  {
    author: "sunna",
    landlord: "gunnar",
    rating: 3,
    title: "Góð staðsetning, hæg viðbrögð",
    body: "Íbúðin er vel staðsett við Hamraborg og stutt í strætó. Viðhaldi er sinnt hægt og það þurfti að ýta á eftir viðgerð á ofninum. Hússjóður er innifalinn í leigunni, sem er þægilegt.",
    daysAgo: 15,
  },
  {
    author: "asdis",
    landlord: "leigufelag",
    rating: 3,
    title: "Fagleg en ópersónuleg þjónusta",
    body: "Allt fer í gegnum þjónustugátt og það getur tekið nokkra daga að fá svar. Viðgerðir eru þó unnar af fagmönnum. Leigan er vísitölutengd og samningurinn var vel útskýrður í upphafi.",
    daysAgo: 20,
  },
  {
    author: "birta",
    landlord: "olafur",
    rating: 5,
    title: "Besti leigusali sem ég hef haft",
    body: "Ólafur býr í næsta húsi og bregst strax við ef eitthvað bilar. Hann skipti um þvottavél í sameiginlega þvottahúsinu á innan við viku og tryggingin var lögð inn á sérstakan reikning.",
    daysAgo: 10,
  },
  {
    author: "thordis",
    landlord: "jon",
    rating: 4,
    title: "Traustur og hjálpsamur",
    body: "Jón sér sjálfur um viðhaldið og kemur fljótt þegar eitthvað bilar. Kyndingin í raðhúsinu var ójöfn fyrsta veturinn, en hann setti upp nýja ofnloka sem bættu úr því.",
    daysAgo: 25,
  },
  // Landlords reviewing renters
  {
    author: "sigrun",
    renter: "eva",
    rating: 5,
    title: "Til fyrirmyndar",
    body: "Eva gekk vel um íbúðina, lét strax vita þegar ofninn fór að leka og skilaði íbúðinni hreinni. Samskiptin voru alltaf auðveld og kurteis.",
    daysAgo: 28,
  },
  {
    author: "sigrun",
    renter: "olafur",
    rating: 4,
    title: "Rólegur og snyrtilegur leigjandi",
    body: "Ólafur leigði stúdíóíbúðina þegar hann var í bænum vegna vinnu. Hann gekk vel um og nágrannarnir höfðu aldrei undan neinu að kvarta.",
    daysAgo: 55,
  },
  {
    author: "sigrun",
    renter: "magnus",
    rating: 3,
    title: "Kurteis en stundum hávaði",
    body: "Magnús var kurteis í samskiptum. Nágrannarnir nefndu nokkrum sinnum tónlist seint á kvöldin, en hann brást vel við þegar ég ræddi það við hann.",
    daysAgo: 90,
  },
  {
    author: "olafur",
    renter: "birta",
    rating: 5,
    title: "Frábær leigjandi",
    body: "Birta hugsaði vel um íbúðina, hélt sameigninni snyrtilegri og lét vita um leið og hún tók eftir raka við gluggann. Ég myndi glaður leigja henni aftur.",
    daysAgo: 8,
  },
  {
    author: "helga",
    renter: "asdis",
    rating: 4,
    title: "Tillitssöm og gekk vel um",
    body: "Ásdís vinnur vaktavinnu en var alltaf tillitssöm við nágrannana. Íbúðin var í góðu ástandi þegar hún skilaði henni.",
    daysAgo: 120,
  },
  {
    author: "jon",
    renter: "david",
    rating: 4,
    title: "Þægileg samskipti",
    body: "Davíð leigði hjá mér í tvö ár. Hann hugsaði vel um garðinn og lét strax vita þegar þakrennan fór að leka.",
    daysAgo: 70,
  },
  {
    author: "jon",
    renter: "thordis",
    rating: 5,
    title: "Mæli eindregið með",
    body: "Þórdís er snyrtileg og skipulögð og samskiptin voru alltaf auðveld. Hún passaði vel upp á að lofta út svo enginn raki myndaðist.",
    daysAgo: 22,
  },
  // Renters reviewing the places they rent
  {
    author: "eva",
    property: "njalsgata",
    rating: 4,
    title: "Björt íbúð í hjarta bæjarins",
    body: "Íbúðin er björt og vel skipulögð, en það heyrist vel í umferðinni á Njálsgötu um helgar. Ekkert bílastæði fylgir, svo það þarf íbúakort fyrir götuna.",
    daysAgo: 29,
  },
  {
    author: "olafur",
    property: "hringbraut",
    rating: 3,
    title: "Lítil en hentug",
    body: "Stúdíóíbúðin er lítil en vel nýtt. Það var stundum kalt á veturna og þvottahúsið er sameiginlegt með þremur öðrum íbúðum.",
    daysAgo: 58,
  },
  {
    author: "kari",
    property: "hamraborg",
    rating: 2,
    title: "Mygla í svefnherberginu",
    body: "Útsýnið er frábært en það myndaðist mygla í horni svefnherbergisins fyrsta veturinn. Loftræstingin er léleg og það þarf að lofta út daglega.",
    daysAgo: 44,
  },
  {
    author: "asdis",
    property: "strandgata",
    rating: 3,
    title: "Notaleg en rök",
    body: "Stutt í höfnina og miðbæ Hafnarfjarðar. Íbúðin er á jarðhæð og það þarf rakatæki allt árið. Bílastæði eru af skornum skammti á kvöldin.",
    daysAgo: 19,
  },
  {
    author: "agnieszka",
    property: "hafnargata",
    rating: 4,
    title: "Quiet flat with good heating",
    body: "The flat is quiet and the heating works well, even in January. The laundry room is shared and can be busy at weekends. Parking on the street is easy to find.",
    daysAgo: 12,
  },
  {
    author: "birta",
    property: "thorunnarstraeti",
    rating: 5,
    title: "Rúmgóð og hlý",
    body: "Hitaveitan heldur íbúðinni hlýrri allt árið og sameiginlegt þvottahús er í kjallaranum. Stutt í háskólann og sundlaugina.",
    daysAgo: 9,
  },
  {
    author: "thordis",
    property: "austurvegur",
    rating: 4,
    title: "Gott raðhús með garði",
    body: "Rúmgóð íbúð með litlum garði og eigin bílastæði. Það heyrist aðeins í umferðinni á Austurvegi en það venst fljótt.",
    daysAgo: 24,
  },
];

function byKey<T extends { key: string }>(items: readonly T[]): { [K in T["key"]]: Extract<T, { key: K }> } {
  return Object.fromEntries(items.map((item) => [item.key, item])) as { [K in T["key"]]: Extract<T, { key: K }> };
}

/** The demo data by key, for tests: `DEMO.people.sigrun.email`, `DEMO.properties.njalsgata.address`. */
export const DEMO = {
  password: DEMO_PASSWORD,
  people: byKey(DEMO_PEOPLE),
  properties: byKey(DEMO_PROPERTIES),
  reviews: DEMO_REVIEWS,
};
