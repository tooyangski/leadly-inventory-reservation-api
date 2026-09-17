import { z } from 'zod';

export const createItemSchema = z.object({
  name: z.string().min(1),
  initial_quantity: z.number().int().positive(),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
