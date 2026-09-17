import { z } from 'zod';

export const createReservationSchema = z.object({
  item_id: z.string().uuid(),
  customer_id: z.string().min(1),
  quantity: z.number().int().positive(),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
