import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { config } from "dotenv";

//Load env vars
config({ path: ".env" });

if (!process.env.DATABASE_URL) {
	throw new Error("NEON_DATABASE_URL is not defined");
}

// Initialize Neon client
const sql = neon(process.env.DATABASE_URL);

// Initialize Drizzle ORM
export const db = drizzle(sql);
