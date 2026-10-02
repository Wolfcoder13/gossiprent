import { count } from "drizzle-orm";
import { hashPassword } from "../lib/auth/password";
import type { Database } from "./connect";
import { properties, reviews, users, type UserRole } from "./schema";

/** Password for every demo account. Only ever used for local/demo data. */
export const DEMO_PASSWORD = "password123";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

type DemoUser = {
  key: string;
  name: string;
  email: string;
  role: UserRole;
  city: string;
  bio: string;
  joinedDaysAgo: number;
};

const DEMO_USERS: DemoUser[] = [
  {
    key: "maria",
    name: "Maria Gonzalez",
    email: "maria@example.com",
    role: "landlord",
    city: "Austin, TX",
    bio: "Family-run rentals since 2009. I live ten minutes from every unit I own and handle repairs myself.",
    joinedDaysAgo: 420,
  },
  {
    key: "northgate",
    name: "Northgate Property Group",
    email: "office@northgate.example.com",
    role: "landlord",
    city: "Chicago, IL",
    bio: "We manage 40+ vintage apartments across Chicago's North Side.",
    joinedDaysAgo: 380,
  },
  {
    key: "sam",
    name: "Sam Whitfield",
    email: "sam@example.com",
    role: "landlord",
    city: "Portland, OR",
    bio: "Owner of two duplexes in Southeast Portland.",
    joinedDaysAgo: 300,
  },
  {
    key: "priya",
    name: "Priya Raman",
    email: "priya@example.com",
    role: "landlord",
    city: "Denver, CO",
    bio: "Small portfolio of renovated condos near downtown Denver.",
    joinedDaysAgo: 250,
  },
  {
    key: "jordan",
    name: "Jordan Ellis",
    email: "jordan@example.com",
    role: "renter",
    city: "Austin, TX",
    bio: "Software tester, plant parent, quiet neighbor.",
    joinedDaysAgo: 400,
  },
  {
    key: "aisha",
    name: "Aisha Bello",
    email: "aisha@example.com",
    role: "renter",
    city: "Chicago, IL",
    bio: "Nurse working night shifts. Renting in Chicago for six years.",
    joinedDaysAgo: 360,
  },
  {
    key: "tom",
    name: "Tom Becker",
    email: "tom@example.com",
    role: "renter",
    city: "Portland, OR",
    bio: "Bike mechanic and amateur woodworker.",
    joinedDaysAgo: 280,
  },
  {
    key: "lena",
    name: "Lena Kowalski",
    email: "lena@example.com",
    role: "renter",
    city: "Chicago, IL",
    bio: "Grad student. Looking for my next place in 2027.",
    joinedDaysAgo: 200,
  },
  {
    key: "marcus",
    name: "Marcus Reed",
    email: "marcus@example.com",
    role: "renter",
    city: "Denver, CO",
    bio: "Remote designer who works from home most days.",
    joinedDaysAgo: 180,
  },
];

type DemoProperty = {
  key: string;
  address: string;
  unit?: string;
  city: string;
  region: string;
  postalCode: string;
  description: string;
  landlord: string;
  createdBy: string;
};

const DEMO_PROPERTIES: DemoProperty[] = [
  {
    key: "east6th",
    address: "1408 E 6th St",
    unit: "2B",
    city: "Austin",
    region: "TX",
    postalCode: "78702",
    description: "One-bedroom apartment above a bakery.",
    landlord: "maria",
    createdBy: "maria",
  },
  {
    key: "riverside",
    address: "2210 Riverside Dr",
    city: "Austin",
    region: "TX",
    postalCode: "78741",
    description: "Three-bedroom house with a fenced yard.",
    landlord: "maria",
    createdBy: "maria",
  },
  {
    key: "clark",
    address: "4521 N Clark St",
    unit: "3",
    city: "Chicago",
    region: "IL",
    postalCode: "60640",
    description: "Vintage two-bedroom walk-up.",
    landlord: "northgate",
    createdBy: "northgate",
  },
  {
    key: "belmont",
    address: "980 W Belmont Ave",
    unit: "12",
    city: "Chicago",
    region: "IL",
    postalCode: "60657",
    description: "Studio in a 1920s courtyard building.",
    landlord: "northgate",
    createdBy: "lena",
  },
  {
    key: "division",
    address: "3315 SE Division St",
    city: "Portland",
    region: "OR",
    postalCode: "97202",
    description: "Lower unit of a duplex with a shared garden.",
    landlord: "sam",
    createdBy: "tom",
  },
  {
    key: "larimer",
    address: "77 Larimer St",
    unit: "504",
    city: "Denver",
    region: "CO",
    postalCode: "80205",
    description: "Renovated one-bedroom condo with mountain views.",
    landlord: "priya",
    createdBy: "priya",
  },
];

type DemoReview = {
  author: string;
  rating: number;
  title: string;
  body: string;
  daysAgo: number;
} & ({ landlord: string } | { renter: string } | { property: string });

const DEMO_REVIEWS: DemoReview[] = [
  // Renters reviewing landlords
  {
    author: "jordan",
    landlord: "maria",
    rating: 5,
    title: "Responsive, fair, and honest",
    body: "Maria fixed a broken AC within a day during a July heat wave. Rent increases were reasonable and always came with written notice. I got my full deposit back when I moved out.",
    daysAgo: 40,
  },
  {
    author: "aisha",
    landlord: "northgate",
    rating: 2,
    title: "Slow maintenance, great location",
    body: "Submitting a request through their portal felt like a black hole. A leaking radiator took three weeks and four follow-ups to fix. The office staff are polite but clearly stretched thin.",
    daysAgo: 25,
  },
  {
    author: "lena",
    landlord: "northgate",
    rating: 3,
    title: "Fine if you're patient",
    body: "Lease signing was smooth and the rent is fair for the area. Repairs do get done eventually, but expect to chase them. Package room security could be better.",
    daysAgo: 12,
  },
  {
    author: "tom",
    landlord: "sam",
    rating: 4,
    title: "Laid-back and reasonable",
    body: "Sam is easygoing and lets you make small improvements as long as you ask first. Communication can be a bit slow over text, but he always follows through.",
    daysAgo: 60,
  },
  {
    author: "marcus",
    landlord: "priya",
    rating: 5,
    title: "Best landlord I've had",
    body: "Clear lease, online rent payments, and a dishwasher replaced within 48 hours. Priya checks in once a year and otherwise respects your privacy completely.",
    daysAgo: 8,
  },
  // Landlords reviewing renters
  {
    author: "maria",
    renter: "jordan",
    rating: 5,
    title: "Ideal tenant",
    body: "Paid on time every month for two years, reported small issues before they became big ones, and left the apartment spotless. I'd rent to Jordan again in a heartbeat.",
    daysAgo: 35,
  },
  {
    author: "northgate",
    renter: "aisha",
    rating: 4,
    title: "Reliable and communicative",
    body: "Rent always arrived on time and Aisha kept us informed about maintenance needs. Very considerate of neighbors despite working night shifts.",
    daysAgo: 20,
  },
  {
    author: "northgate",
    renter: "lena",
    rating: 4,
    title: "Respectful tenant",
    body: "No complaints from neighbors and the unit was well cared for. One late payment early on, quickly resolved with a heads-up in advance.",
    daysAgo: 10,
  },
  {
    author: "sam",
    renter: "tom",
    rating: 3,
    title: "Good tenant, a few late payments",
    body: "Tom took great care of the garden and even fixed a sticky door himself. Rent was late three times last year, though he always paid the late fee without argument.",
    daysAgo: 55,
  },
  {
    author: "priya",
    renter: "marcus",
    rating: 5,
    title: "Would rent to again",
    body: "Marcus is tidy, quiet, and responsive. He flagged a small leak under the sink right away, which saved us a much bigger repair.",
    daysAgo: 5,
  },
  // Renters reviewing the places they rent
  {
    author: "jordan",
    property: "east6th",
    rating: 4,
    title: "Charming, but noisy on weekends",
    body: "Great natural light and the smell of fresh bread every morning. East 6th gets loud on Friday and Saturday nights, so bring earplugs if you're a light sleeper.",
    daysAgo: 38,
  },
  {
    author: "aisha",
    property: "clark",
    rating: 3,
    title: "Lovely bones, drafty windows",
    body: "Hardwood floors, big rooms, and a short walk to the Red Line. The original windows let in a lot of cold air, so heating bills in January were brutal.",
    daysAgo: 24,
  },
  {
    author: "lena",
    property: "belmont",
    rating: 4,
    title: "Cozy studio with a great courtyard",
    body: "Small but smartly laid out, with a closet bigger than expected. The courtyard is a peaceful place to study. Laundry is in the basement and often busy on Sundays.",
    daysAgo: 11,
  },
  {
    author: "tom",
    property: "division",
    rating: 4,
    title: "Solid duplex, thin shared wall",
    body: "Plenty of space, a shared garden, and great restaurants nearby. You can hear the upstairs neighbors walking around, but the layout and storage make up for it.",
    daysAgo: 58,
  },
  {
    author: "marcus",
    property: "larimer",
    rating: 5,
    title: "Modern, bright, and quiet",
    body: "Recently renovated with new appliances, fast building Wi-Fi, and views of the Front Range from the bedroom. Elevator is reliable and the gym is a nice bonus.",
    daysAgo: 7,
  },
];

/**
 * Insert a small, realistic set of landlords, renters, properties, and reviews.
 * Does nothing if the database already has users.
 */
export async function seedDemoData(db: Database): Promise<boolean> {
  const [{ value: existingUsers }] = await db
    .select({ value: count() })
    .from(users);
  if (existingUsers > 0) return false;

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.transaction(async (tx) => {
    const insertedUsers = await tx
      .insert(users)
      .values(
        DEMO_USERS.map((u) => ({
          name: u.name,
          email: u.email,
          passwordHash,
          role: u.role,
          city: u.city,
          bio: u.bio,
          createdAt: daysAgo(u.joinedDaysAgo),
        })),
      )
      .returning({ id: users.id, email: users.email });
    const userId = (key: string) => {
      const email = DEMO_USERS.find((u) => u.key === key)!.email;
      return insertedUsers.find((u) => u.email === email)!.id;
    };

    const insertedProperties = await tx
      .insert(properties)
      .values(
        DEMO_PROPERTIES.map((p, i) => ({
          address: p.address,
          unit: p.unit ?? null,
          city: p.city,
          region: p.region,
          postalCode: p.postalCode,
          description: p.description,
          landlordId: userId(p.landlord),
          createdById: userId(p.createdBy),
          createdAt: daysAgo(170 - i * 10),
        })),
      )
      .returning({ id: properties.id, address: properties.address });
    const propertyId = (key: string) => {
      const address = DEMO_PROPERTIES.find((p) => p.key === key)!.address;
      return insertedProperties.find((p) => p.address === address)!.id;
    };

    await tx.insert(reviews).values(
      DEMO_REVIEWS.map((r) => {
        const createdAt = daysAgo(r.daysAgo);
        const base = {
          authorId: userId(r.author),
          rating: r.rating,
          title: r.title,
          body: r.body,
          createdAt,
          updatedAt: createdAt,
        };
        if ("landlord" in r) {
          return { ...base, kind: "landlord" as const, subjectUserId: userId(r.landlord) };
        }
        if ("renter" in r) {
          return { ...base, kind: "renter" as const, subjectUserId: userId(r.renter) };
        }
        return { ...base, kind: "property" as const, propertyId: propertyId(r.property) };
      }),
    );
  });

  return true;
}
