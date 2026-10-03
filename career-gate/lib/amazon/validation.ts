import { z } from "zod";

export const normalizeAmazonEmail = (value: string) => value.trim().toLowerCase();

const Email = z.string().trim().max(320).email().transform(normalizeAmazonEmail);
const Password = z.string().min(8).max(512);
const Pin = z.string().trim().regex(/^\d{4,12}$/, "PIN must contain 4 to 12 digits");
const Id = z.string().uuid();

export const AddAmazonEmailSchema = z.object({ email: Email, password: Password, pin: Pin });
export type AddAmazonEmailInput = z.infer<typeof AddAmazonEmailSchema>;

export const BulkAmazonEmailSchema = z.object({
  mode: z.enum(["preview", "commit"]),
  rows: z.array(z.object({ email: z.string(), password: z.string(), pin: z.string() })).min(1).max(200),
});

export const UpdateAmazonEmailSchema = z.object({
  id: Id,
  email: Email.optional(),
  password: Password.optional(),
  pin: Pin.optional(),
}).refine((value) => value.email !== undefined || value.password !== undefined || value.pin !== undefined, "No changes supplied");

export const DeleteAmazonEmailSchema = z.object({ id: Id });

export const RevealAmazonEmailSchema = z.object({
  id: Id,
  field: z.enum(["password", "pin"]),
  intent: z.enum(["reveal", "copy"]),
});

export const AmazonAssignmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("reserve"), email_id: Id, client_id: Id }),
  z.object({ mode: z.literal("confirm"), email_id: Id, client_id: Id }),
  z.object({ mode: z.literal("release"), email_id: Id }),
]);

export const AmazonAccountIdSchema = z.object({ account_id: Id });

export const RevealAmazonAccountSchema = z.object({
  account_id: Id,
  field: z.enum(["password", "pin"]),
  intent: z.enum(["reveal", "copy"]),
});

export const UpdateAmazonAccountSchema = z.object({
  account_id: Id,
  email: Email.optional(),
  password: Password.optional(),
  pin: Pin.optional(),
}).refine((value) => value.email !== undefined || value.password !== undefined || value.pin !== undefined, "No changes supplied");
