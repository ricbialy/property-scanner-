import { createPool } from "../pool.js";
import { createOrganizationWithOwner } from "../repositories/organizations.js";
import { createProperty } from "../repositories/properties.js";
import { createFloor } from "../repositories/floors.js";

/**
 * Development seed: a deterministic demo tenant for local work. The dev user id
 * matches AUTH_MODE=dev tokens ("Bearer dev_user_demo_owner"). Never run against
 * shared or production databases.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (process.env.APP_ENV === "production") {
  console.error("Refusing to seed a production environment");
  process.exit(1);
}

const pool = createPool(databaseUrl);

try {
  const existing = await pool.query("select 1 from organizations where name = $1", [
    "Demo Construction Co"
  ]);
  if (existing.rows.length > 0) {
    console.error("Seed data already present; skipping");
  } else {
    const org = await createOrganizationWithOwner(pool, {
      name: "Demo Construction Co",
      ownerUserId: "user_demo_owner"
    });
    const property = await createProperty(pool, org.id, {
      name: "Sample Residence",
      addressLine1: "100 Demo Street",
      city: "Springfield",
      region: "IL",
      postalCode: "62701",
      country: "US"
    });
    await createFloor(pool, org.id, {
      propertyId: property.id,
      name: "First Floor",
      ordinal: 0,
      displayUnits: "imperial"
    });
    console.error(`Seeded demo organization ${org.id} with property ${property.id}`);
  }
} finally {
  await pool.end();
}
