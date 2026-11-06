import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";
import { missingForApproval } from "../lib/contact";
import { loadContact } from "../lib/contact-public";

// Go-live check for the shop and company details (R9.9, R11.11): exits 1 until the owner has saved
// the details once in Settings and supplied the legal name, Companies House number and registered office.
//   npm run contact:check
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");
const { contact, confirmed } = await loadContact(drizzle(neon(url), { schema }));
const missing = missingForApproval(contact);
if (!confirmed) console.log("NOT READY: the owner has not saved the shop details in Settings yet (the starting values from Google Maps are still in use).");
if (missing.length) console.log(`NOT READY: still missing: ${missing.join(", ")}.`);
if (confirmed && !missing.length) console.log(`OK: details confirmed. ${contact.legalName}, company ${contact.companyNumber}, ${contact.registeredOffice}.`);
else process.exitCode = 1;
