import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    "[db] Warning: DATABASE_URL is not set in environment variables. Database queries will fail until it is configured."
  );
}

const sql = neon(connectionString || "");

export const db = drizzle(sql, { schema });

export * from "./schema";
