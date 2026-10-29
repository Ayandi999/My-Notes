import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Example starter table / schema definition
// Feel free to add or modify tables as needed for notebooks, sources, transcripts, etc.

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  cloudinaryPublicId: text("cloudinary_public_id"),
  mimeType: text("mime_type"),
  size: text("size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
