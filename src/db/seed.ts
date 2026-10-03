import { count } from "drizzle-orm";
import { hashPassword } from "../lib/auth/password";
import { personNameKeys, propertyAddressKeys } from "../lib/text";
import type { Database } from "./connect";
import {
  DEMO_PASSWORD,
  DEMO_PEOPLE,
  DEMO_PROPERTIES,
  DEMO_REVIEWS,
  type DemoPersonKey,
  type DemoReview,
} from "./demo-people";
import { properties, reviews, users, type ReviewKind } from "./schema";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const reviewKind = (review: DemoReview): ReviewKind =>
  "landlord" in review ? "landlord" : "renter" in review ? "renter" : "property";

/**
 * What the demo reviews and property links say about each person: the roles
 * they've been reviewed or linked in, and how many days ago that first happened
 * (when a profile without an account would have been created).
 */
function mentions(): Map<DemoPersonKey, { isLandlord: boolean; isRenter: boolean; firstDaysAgo: number }> {
  const result = new Map<DemoPersonKey, { isLandlord: boolean; isRenter: boolean; firstDaysAgo: number }>();
  const mention = (key: DemoPersonKey, role: "landlord" | "renter", days: number) => {
    const current = result.get(key) ?? { isLandlord: false, isRenter: false, firstDaysAgo: 0 };
    result.set(key, {
      isLandlord: current.isLandlord || role === "landlord",
      isRenter: current.isRenter || role === "renter",
      firstDaysAgo: Math.max(current.firstDaysAgo, days),
    });
  };
  for (const review of DEMO_REVIEWS) {
    if ("landlord" in review) mention(review.landlord, "landlord", review.daysAgo);
    if ("renter" in review) mention(review.renter, "renter", review.daysAgo);
  }
  for (const property of DEMO_PROPERTIES) mention(property.landlord, "landlord", property.addedDaysAgo);
  return result;
}

/**
 * Insert the demo people, properties and reviews (src/db/demo-people.ts).
 * Does nothing if the database already has users.
 */
export async function seedDemoData(db: Database): Promise<boolean> {
  const [{ value: existingUsers }] = await db.select({ value: count() }).from(users);
  if (existingUsers > 0) return false;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mentioned = mentions();

  await db.transaction(async (tx) => {
    const insertedUsers = await tx
      .insert(users)
      .values(
        DEMO_PEOPLE.map((person) => {
          const earned = mentioned.get(person.key);
          const roles: readonly string[] = person.roles;
          const base = { kennitala: person.kennitala, isCompany: person.isCompany, ...personNameKeys(person.name) };
          if (!person.hasAccount) {
            // A profile without an account exists only because of its reviews and links.
            return {
              ...base,
              isLandlord: earned?.isLandlord ?? false,
              isRenter: earned?.isRenter ?? false,
              createdAt: daysAgo(earned?.firstDaysAgo ?? 0),
            };
          }
          const joinedAt = daysAgo(person.joinedDaysAgo);
          return {
            ...base,
            email: person.email,
            passwordHash,
            joinedAt,
            isLandlord: roles.includes("landlord") || (earned?.isLandlord ?? false),
            isRenter: roles.includes("renter") || (earned?.isRenter ?? false),
            city: person.city,
            bio: person.bio,
            createdAt: joinedAt,
          };
        }),
      )
      .returning({ id: users.id, kennitala: users.kennitala });
    const userIds = new Map(
      DEMO_PEOPLE.map((person) => [person.key, insertedUsers.find((row) => row.kennitala === person.kennitala)!.id]),
    );
    const userId = (key: DemoPersonKey) => userIds.get(key)!;

    const propertyKeys = DEMO_PROPERTIES.map((property) => ({
      property,
      ...propertyAddressKeys(property.address, "unit" in property ? property.unit : null),
    }));
    const insertedProperties = await tx
      .insert(properties)
      .values(
        propertyKeys.map(({ property, ...keys }) => ({
          ...keys,
          postalCode: property.postalCode,
          description: property.description,
          landlordId: userId(property.landlord),
          // Listed by the landlord themselves; otherwise a renter named them.
          landlordConfirmed: property.landlord === property.createdBy,
          createdById: userId(property.createdBy),
          createdAt: daysAgo(property.addedDaysAgo),
        })),
      )
      .returning({ id: properties.id, addressSearch: properties.addressSearch, postalCode: properties.postalCode });
    const propertyIds = new Map(
      propertyKeys.map(({ property, addressSearch }) => [
        property.key,
        insertedProperties.find((row) => row.addressSearch === addressSearch && row.postalCode === property.postalCode)!
          .id,
      ]),
    );

    await tx.insert(reviews).values(
      DEMO_REVIEWS.map((review) => {
        const createdAt = daysAgo(review.daysAgo);
        return {
          kind: reviewKind(review),
          authorId: userId(review.author),
          subjectUserId:
            "landlord" in review ? userId(review.landlord) : "renter" in review ? userId(review.renter) : null,
          propertyId: "property" in review ? propertyIds.get(review.property)! : null,
          rating: review.rating,
          title: review.title,
          body: review.body,
          createdAt,
          updatedAt: createdAt,
        };
      }),
    );
  });

  return true;
}
