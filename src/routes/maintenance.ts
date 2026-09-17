import { Router } from 'express';
import { expireReservations } from '../services/reservations';

export const maintenanceRouter = Router();

maintenanceRouter.post('/expire-reservations', async (_req, res, next) => {
  try {
    const result = await expireReservations();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
