import { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { createReservationSchema } from '../validation/reservations';
import { createReservation, confirmReservation, cancelReservation } from '../services/reservations';

export const reservationsRouter = Router();

reservationsRouter.post('/', validateBody(createReservationSchema), async (req, res, next) => {
  try {
    const { item_id, customer_id, quantity } = req.body;
    const reservation = await createReservation({ itemId: item_id, customerId: customer_id, quantity });
    res.status(201).json(reservation);
  } catch (err) {
    next(err);
  }
});

reservationsRouter.post('/:id/confirm', async (req, res, next) => {
  try {
    const reservation = await confirmReservation(req.params.id);
    res.json(reservation);
  } catch (err) {
    next(err);
  }
});

reservationsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const reservation = await cancelReservation(req.params.id);
    res.json(reservation);
  } catch (err) {
    next(err);
  }
});
