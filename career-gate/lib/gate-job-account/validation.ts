import { z } from "zod";

export const normalizeGateJobEmail = (value: string) => value.trim().toLowerCase();

const Email = z.string().trim().max(320).email().transform(normalizeGateJobEmail);
const Password = z.string().min(8).max(512);
const Pin = z.string().trim().regex(/^\d{4,12}$/, "PIN must contain 4 to 12 digits");
const Id = z.string().uuid();

export const AddGateJobEmailSchema = z.object({ email: Email, password: Password, pin: Pin });
export type AddGateJobEmailInput = z.infer<typeof AddGateJobEmailSchema>;

export const BulkGateJobEmailSchema = z.object({
  mode: z.enum(["preview", "commit"]),
  rows: z.array(z.object({ email: z.string(), password: z.string(), pin: z.string() })).min(1).max(200),
});

export const UpdateGateJobEmailSchema = z.object({
  id: Id,
  email: Email.optional(),
  password: Password.optional(),
  pin: Pin.optional(),
}).refine((value) => value.email !== undefined || value.password !== undefined || value.pin !== undefined, "No changes supplied");

export const DeleteGateJobEmailSchema = z.object({ id: Id });

export const RevealGateJobEmailSchema = z.object({
  id: Id,
  field: z.enum(["password", "pin"]),
  intent: z.enum(["reveal", "copy"]),
});

export const GateJobAssignmentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("reserve"), email_id: Id, client_id: Id }),
  z.object({ mode: z.literal("confirm"), email_id: Id, client_id: Id }),
  z.object({ mode: z.literal("release"), email_id: Id }),
]);

export const GateJobAccountIdSchema = z.object({ account_id: Id });

export const RevealGateJobAccountSchema = z.object({
  account_id: Id,
  field: z.enum(["password", "pin"]),
  intent: z.enum(["reveal", "copy"]),
});

export const UpdateGateJobAccountSchema = z.object({
  account_id: Id,
  email: Email.optional(),
  password: Password.optional(),
  pin: Pin.optional(),
}).refine((value) => value.email !== undefined || value.password !== undefined || value.pin !== undefined, "No changes supplied");
